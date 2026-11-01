import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import OpenAI from 'openai';
import { PrismaService } from '../prisma/prisma.service';
import { SuggestCategoryResult } from './dto/suggest-category.dto';
import { CleanDescriptionResult } from './dto/clean-description.dto';
import { ParsedExpenseResult } from './dto/parse-expense.dto';
import { ImproveDescriptionItemDto, ImprovedDescription } from './dto/improve-descriptions.dto';
import {
  DESCRIPTION_MAX_LENGTH,
  DESCRIPTION_PATTERN,
  tidyDescription,
  titleCaseDescription,
  validateDescription,
} from '../../common/description-rules';
import { defaultBucketForCategory, suggestionPool } from '../coa-tags/coa-defaults';

interface WorkspaceCoa {
  categoryId: string;
  categoryName: string;
  tagId: string;
  tagName: string;
}

const STOP_WORDS = new Set(['and', 'the', 'for', 'of', 'to', 'in', 'on', 'with', 'per', 'other', 'general', 'cost', 'costs', 'fees', 'fee']);

function tokens(s: string): string[] {
  return (s ?? '')
    .toLowerCase()
    .replace(/[^a-z ]/g, ' ')
    .split(/\s+/)
    .filter((t) => t.length >= 3 && !STOP_WORDS.has(t))
    .map((t) => t.replace(/(ies)$/, 'y').replace(/s$/, ''));
}

/**
 * Best-effort LLM assistance. Every public method here is designed to NEVER throw back to the
 * caller — a missing/invalid API key, a provider outage, or an unparsable model response all
 * degrade to a low-confidence/empty result, logged via Logger, rather than a 500. This mirrors
 * tarione's AiService (api/src/modules/ai/ai.service.ts), which builds its client lazily so a
 * missing key can't crash app startup.
 */
@Injectable()
export class AiService {
  private readonly logger = new Logger(AiService.name);
  private _client: OpenAI | undefined;
  private _unconfigured = false;

  constructor(
    private readonly configService: ConfigService,
    private readonly prisma: PrismaService,
  ) {}

  private get model(): string {
    const deepseekKey = this.configService.get<string>('ai.deepseekApiKey');
    const openaiKey = this.configService.get<string>('ai.openaiApiKey');
    // Prefer DeepSeek when configured and no OpenAI key is present (per spec); otherwise OpenAI.
    return deepseekKey && !openaiKey ? 'deepseek-chat' : 'gpt-4o-mini';
  }

  private get client(): OpenAI | undefined {
    if (this._client) return this._client;
    if (this._unconfigured) return undefined;

    const deepseekKey = this.configService.get<string>('ai.deepseekApiKey');
    const openaiKey = this.configService.get<string>('ai.openaiApiKey');

    try {
      if (openaiKey) {
        this._client = new OpenAI({ apiKey: openaiKey });
      } else if (deepseekKey) {
        this._client = new OpenAI({ apiKey: deepseekKey, baseURL: 'https://api.deepseek.com' });
      } else {
        this._unconfigured = true;
        this.logger.warn('AI features requested but neither OPENAI_API_KEY nor DEEPSEEK_API_KEY is configured');
        return undefined;
      }
    } catch (error) {
      this._unconfigured = true;
      this.logger.error('Failed to construct AI provider client', error as Error);
      return undefined;
    }

    return this._client;
  }

  private async completeJson(system: string, user: string, maxTokens = 500): Promise<Record<string, any> | null> {
    const client = this.client;
    if (!client) return null;

    try {
      const response = await client.chat.completions.create({
        model: this.model,
        messages: [
          { role: 'system', content: system },
          { role: 'user', content: user },
        ],
        response_format: { type: 'json_object' },
        max_tokens: maxTokens,
        temperature: 0.2,
      });

      const text = response.choices[0]?.message?.content;
      if (!text) return null;
      return JSON.parse(text);
    } catch (error) {
      this.logger.error('AI provider call failed', error as Error);
      return null;
    }
  }

  async suggestCategory(
    workspaceId: string,
    description: string,
    amount?: number,
  ): Promise<SuggestCategoryResult> {
    const fallback: SuggestCategoryResult = {
      suggestedCategoryName: '',
      confidence: 'low',
      isNewCategory: false,
    };

    let categoryNames: string[] = [];
    try {
      const categories = await this.prisma.payCategory.findMany({
        where: { workspaceId, isActive: true },
        select: { name: true },
        orderBy: { name: 'asc' },
      });
      categoryNames = categories.map((c) => c.name);
    } catch (error) {
      this.logger.error('Failed to load pay categories for AI category suggestion', error as Error);
    }

    const system = `You are an expert bookkeeper for a Nigerian SME. Given a vendor invoice/expense description, pick the single best-matching pay category from the workspace's existing list. If none fit reasonably well, suggest a short, professional new category name instead.
Respond ONLY with a JSON object: { "suggestedCategoryName": string, "confidence": "high" | "low", "isNewCategory": boolean }.
"confidence" is "high" only when an existing category is a strong, unambiguous match.`;

    const user = `Existing pay categories: ${categoryNames.length ? categoryNames.join(', ') : '(none yet)'}
Description: "${description}"
${amount !== undefined ? `Amount: NGN ${amount}` : ''}`;

    const result = await this.completeJson(system, user);
    if (!result || typeof result.suggestedCategoryName !== 'string') {
      return fallback;
    }

    return {
      suggestedCategoryName: result.suggestedCategoryName,
      confidence: result.confidence === 'high' ? 'high' : 'low',
      isNewCategory: Boolean(result.isNewCategory),
    };
  }

  async cleanDescription(rawDescription: string): Promise<CleanDescriptionResult> {
    const system = `You clean up messy vendor invoice descriptions into a single clean, professional one-line description suitable for an accounting ledger. Do not invent facts not present in the input. Respond ONLY with a JSON object: { "cleaned": string }.`;
    const user = `Raw description: "${rawDescription}"`;

    const result = await this.completeJson(system, user);
    if (!result || typeof result.cleaned !== 'string' || !result.cleaned.trim()) {
      // Graceful degradation: return the original text, trimmed, rather than fail the request.
      return { cleaned: rawDescription.trim() };
    }

    return { cleaned: result.cleaned.trim() };
  }

  async parseExpense(freeText: string): Promise<ParsedExpenseResult> {
    const fallback: ParsedExpenseResult = {
      vendorName: null,
      amount: null,
      description: null,
      invoiceDate: null,
    };

    const system = `Extract structured expense data from a freeform pasted note (often a WhatsApp message about a purchase). Respond ONLY with a JSON object with these exact keys: { "vendorName": string | null, "amount": number | null, "description": string | null, "invoiceDate": string | null }.
"invoiceDate" must be an ISO date string (YYYY-MM-DD) if a date can be determined, otherwise null. "amount" must be a plain number in Naira (no currency symbols or commas) if determinable, otherwise null. Set any field to null if it cannot be confidently extracted — never guess.`;
    const user = `Note: "${freeText}"`;

    const result = await this.completeJson(system, user);
    if (!result) return fallback;

    return {
      vendorName: typeof result.vendorName === 'string' ? result.vendorName : null,
      amount: typeof result.amount === 'number' ? result.amount : null,
      description: typeof result.description === 'string' ? result.description : null,
      invoiceDate: typeof result.invoiceDate === 'string' ? result.invoiceDate : null,
    };
  }

  // ── COA AI Suggest (spec §5.10 #13) ───────────────────────────────────────────────────────

  /**
   * Suggest new COA tags for a category, tailored to the workspace's industry. Never throws;
   * falls back to a curated industry pool when no LLM key is configured. Existing tags excluded.
   */
  async suggestCoaTags(params: {
    categoryName: string;
    industry?: string | null;
    existing?: string[];
    limit?: number;
  }): Promise<{ suggestions: string[]; source: 'ai' | 'rules' }> {
    const limit = Math.min(Math.max(params.limit ?? 8, 1), 20);
    const existingLower = new Set((params.existing ?? []).map((e) => e.trim().toLowerCase()));
    const clean = (list: unknown[]): string[] => {
      const out: string[] = [];
      for (const v of list) {
        if (typeof v !== 'string') continue;
        const t = v.replace(/\s+/g, ' ').trim().slice(0, 80);
        if (t && !existingLower.has(t.toLowerCase()) && !out.some((o) => o.toLowerCase() === t.toLowerCase())) out.push(t);
      }
      return out.slice(0, limit);
    };

    const system = `You are a chartered accountant setting up a chart of accounts for a Nigerian business.
Suggest concise COA (chart-of-accounts) expense tags for ONE payment category. Use Title Case, "&" instead of "and", no numbering, max 40 characters each.
Respond ONLY with JSON: { "suggestions": string[] }.`;
    const user = `Industry: ${params.industry?.trim() || 'general business'}
Payment category: ${params.categoryName}
Already have (do not repeat): ${(params.existing ?? []).join('; ') || '(none)'}
Give up to ${limit} suggestions.`;
    const result = await this.completeJson(system, user, 400);
    if (result && Array.isArray(result.suggestions)) {
      const suggestions = clean(result.suggestions);
      if (suggestions.length) return { suggestions, source: 'ai' };
    }
    const pool = suggestionPool(defaultBucketForCategory(params.categoryName), params.industry);
    return { suggestions: clean(pool), source: 'rules' };
  }

  // ── Tidy up / Improve with AI (spec §7) ───────────────────────────────────────────────────

  private async loadWorkspaceCoa(workspaceId: string): Promise<WorkspaceCoa[]> {
    try {
      const tags = await this.prisma.coaTag.findMany({
        where: { workspaceId, isActive: true, payCategory: { isActive: true } },
        select: { id: true, name: true, payCategory: { select: { id: true, name: true } } },
        orderBy: [{ payCategory: { sortOrder: 'asc' } }, { sortOrder: 'asc' }],
      });
      return tags.map((t) => ({ categoryId: t.payCategory.id, categoryName: t.payCategory.name, tagId: t.id, tagName: t.name }));
    } catch (error) {
      this.logger.error('Failed to load COA tags for description improvement', error as Error);
      return [];
    }
  }

  /** Keyword-overlap COA guess from the workspace's own tags (deterministic fallback). */
  private guessCoa(description: string, coa: WorkspaceCoa[]): { match: WorkspaceCoa; score: number } | null {
    const words = new Set(tokens(description));
    if (!words.size) return null;
    let best: { match: WorkspaceCoa; score: number } | null = null;
    for (const c of coa) {
      const tagWords = tokens(c.tagName);
      if (!tagWords.length) continue;
      const hits = tagWords.filter((w) => words.has(w) || [...words].some((d) => d.length >= 4 && (d.startsWith(w) || w.startsWith(d)))).length;
      const score = hits / tagWords.length;
      if (hits > 0 && (!best || score > best.score)) best = { match: c, score };
    }
    return best;
  }

  private finalize(text: string, item: ImproveDescriptionItemDto): string {
    let out = (text ?? '').replace(/\s+/g, ' ').trim().replace(/\.+$/, '');
    // Re-run the deterministic tidy over the model output so the guide is always enforced
    // (title case, separators, units, trailing date).
    out = tidyDescription(out, { vendorName: item.vendorName, date: item.date });
    return titleCaseDescription(out);
  }

  /**
   * Batch "Tidy up / Improve with AI". Returns one entry per input (same order) with the
   * original, the improved text, remaining rule violations, and a category + COA suggestion
   * drawn ONLY from the workspace's own tags. Never throws.
   */
  async improveDescriptions(workspaceId: string, items: ImproveDescriptionItemDto[]): Promise<{ items: ImprovedDescription[]; source: 'ai' | 'rules' }> {
    const coa = await this.loadWorkspaceCoa(workspaceId);
    const byKey = new Map(coa.map((c) => [`${c.categoryName.toLowerCase()}|${c.tagName.toLowerCase()}`, c]));
    const byTag = new Map<string, WorkspaceCoa>();
    for (const c of coa) if (!byTag.has(c.tagName.toLowerCase())) byTag.set(c.tagName.toLowerCase(), c);

    let ai: Array<{ description?: string; payCategory?: string; coaTag?: string }> | null = null;
    if (items.length) {
      const coaList = Object.entries(
        coa.reduce<Record<string, string[]>>((acc, c) => {
          (acc[c.categoryName] ??= []).push(c.tagName);
          return acc;
        }, {}),
      )
        .map(([cat, tags]) => `${cat}: ${tags.join('; ')}`)
        .join('\n');
      const system = `You rewrite payment line descriptions for a Nigerian business ledger to this guide:
- Pattern: "${DESCRIPTION_PATTERN}" — segments separated by " – " (spaced en-dash). At least 2 segments.
- Start with the item; never start with "Purchase of" or "Payment for". No trailing full stop.
- End with the date as DD/MM/YYYY (use the line's date if given), or a month like "Sep 2026", or "Week N" for staff pay/utilities.
- Never use a vague word alone (misc, items, supplies, petty cash, salary, allowance, payment, purchase); allowances must state their kind ("Allowance – Transport – Sep 2026").
- Do not repeat the vendor name. ${DESCRIPTION_MAX_LENGTH} characters max. No space before units (500ml, 25L, 1kg).
- Title Case, small words (of, and, for, the, per…) lowercase. Do not invent facts.
Also pick the best payment category and COA tag for each line, using ONLY this workspace list (or null if nothing fits):
${coaList || '(no COA tags configured)'}
Respond ONLY with JSON: { "items": [{ "index": number, "description": string, "payCategory": string|null, "coaTag": string|null }] } — one per input, same index.`;
      const user = JSON.stringify(
        items.map((it, index) => ({
          index,
          description: it.description,
          vendor: it.vendorName ?? null,
          date: it.date ?? null,
          amount: it.amount ?? null,
        })),
      );
      const result = await this.completeJson(system, user, Math.min(4000, 200 + items.length * 90));
      if (result && Array.isArray(result.items)) {
        ai = items.map((_, i) => {
          const hit = result.items.find((r: any) => r && r.index === i) ?? result.items[i];
          return hit && typeof hit === 'object' ? hit : {};
        });
      }
    }

    const out = items.map((item, i): ImprovedDescription => {
      const a = ai?.[i];
      const improvedRaw = a && typeof a.description === 'string' && a.description.trim() ? a.description : item.description;
      const improved = this.finalize(improvedRaw, item);

      let suggestion: ImprovedDescription['suggestion'] = null;
      if (a && typeof a.coaTag === 'string') {
        const match =
          (typeof a.payCategory === 'string' && byKey.get(`${a.payCategory.toLowerCase()}|${a.coaTag.toLowerCase()}`)) ||
          byTag.get(a.coaTag.toLowerCase());
        if (match) suggestion = { ...this.toSuggestion(match), confidence: 'high' };
      }
      if (!suggestion) {
        const guess = this.guessCoa(`${item.description} ${improved}`, coa);
        if (guess) suggestion = { ...this.toSuggestion(guess.match), confidence: guess.score >= 0.5 ? 'medium' : 'low' };
      }

      return {
        id: item.id ?? null,
        original: item.description,
        improved,
        changed: improved !== item.description.trim(),
        errors: validateDescription(improved, item.vendorName),
        originalErrors: validateDescription(item.description, item.vendorName),
        suggestion,
      };
    });
    return { items: out, source: ai ? 'ai' : 'rules' };
  }

  private toSuggestion(c: WorkspaceCoa) {
    return { payCategoryId: c.categoryId, payCategoryName: c.categoryName, coaTagId: c.tagId, coaTagName: c.tagName };
  }
}
