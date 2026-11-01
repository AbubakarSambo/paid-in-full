import { Controller, Post, Body } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { AiService } from './ai.service';
import { SuggestCategoryDto } from './dto/suggest-category.dto';
import { CleanDescriptionDto } from './dto/clean-description.dto';
import { ParseExpenseDto } from './dto/parse-expense.dto';
import { ImproveDescriptionsDto, ValidateDescriptionDto } from './dto/improve-descriptions.dto';
import { Capability, CurrentUser, DESCRIPTION_MAX_LENGTH, DESCRIPTION_PATTERN, RequireCapability, validateDescription } from '../../common';

@ApiTags('AI')
@ApiBearerAuth()
@Controller('ai')
export class AiController {
  constructor(private readonly aiService: AiService) {}

  @Post('suggest-category')
  @ApiOperation({ summary: 'Best-effort AI suggestion of the pay category for a description (degrades gracefully)' })
  async suggestCategory(@CurrentUser('workspaceId') workspaceId: string, @Body() dto: SuggestCategoryDto) {
    return this.aiService.suggestCategory(workspaceId, dto.description, dto.amount);
  }

  @Post('clean-description')
  @ApiOperation({ summary: 'Turn a messy free-text description into a clean one-liner (degrades gracefully)' })
  async cleanDescription(@Body() dto: CleanDescriptionDto) {
    return this.aiService.cleanDescription(dto.rawDescription);
  }

  @Post('parse-expense')
  @ApiOperation({ summary: 'Extract vendor/amount/description/date from a pasted freeform note (degrades gracefully)' })
  async parseExpense(@Body() dto: ParseExpenseDto) {
    return this.aiService.parseExpense(dto.freeText);
  }

  @Post('validate-description')
  @ApiOperation({ summary: 'Spec §7 Description Rules: one message per failed rule' })
  validateDescription(@Body() dto: ValidateDescriptionDto) {
    const errors = validateDescription(dto.description, dto.vendorName);
    return { valid: errors.length === 0, errors, pattern: DESCRIPTION_PATTERN, maxLength: DESCRIPTION_MAX_LENGTH };
  }

  @Post('improve-descriptions')
  @RequireCapability(Capability.REQUEST)
  @ApiOperation({
    summary:
      'Tidy up / Improve with AI (batch): rewrite to the guide, title-case, and suggest category + COA from the workspace tags',
  })
  improveDescriptions(@CurrentUser('workspaceId') workspaceId: string, @Body() dto: ImproveDescriptionsDto) {
    return this.aiService.improveDescriptions(workspaceId, dto.items);
  }
}
