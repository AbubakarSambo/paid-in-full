import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import OpenAI from 'openai';
import { PrismaService } from '../prisma/prisma.service';
import { SuggestCategoryResult } from './dto/suggest-category.dto';
import { CleanDescriptionResult } from './dto/clean-description.dto';
import { ParsedExpenseResult } from './dto/parse-expense.dto';

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

  private async completeJson(system: string, user: string): Promise<Record<string, any> | null> {
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
        max_tokens: 500,
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
}
