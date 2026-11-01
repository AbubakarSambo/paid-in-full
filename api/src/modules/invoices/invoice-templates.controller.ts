import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { InvoiceTemplatesService } from './invoice-templates.service';
import { CreateInvoiceTemplateDto, UpdateInvoiceTemplateDto } from './dto';
import { CurrentUser, CurrentUserData, Capability, RequireCapability } from '../../common';

@ApiTags('Invoice Templates')
@ApiBearerAuth()
@RequireCapability(Capability.INVOICE)
@Controller('invoice-templates')
export class InvoiceTemplatesController {
  constructor(private readonly templatesService: InvoiceTemplatesService) {}

  @Get()
  @ApiOperation({ summary: 'List invoice templates' })
  findAll(@CurrentUser('workspaceId') workspaceId: string) {
    return this.templatesService.findAll(workspaceId);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get an invoice template' })
  findOne(@Param('id', ParseUUIDPipe) id: string, @CurrentUser('workspaceId') workspaceId: string) {
    return this.templatesService.findOne(id, workspaceId);
  }

  @Post()
  @ApiOperation({ summary: 'Create an invoice template' })
  create(@Body() dto: CreateInvoiceTemplateDto, @CurrentUser() user: CurrentUserData) {
    return this.templatesService.create(user.workspaceId, dto);
  }

  @Patch(':id')
  @ApiOperation({ summary: 'Update an invoice template' })
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateInvoiceTemplateDto,
    @CurrentUser('workspaceId') workspaceId: string,
  ) {
    return this.templatesService.update(id, workspaceId, dto);
  }

  @Delete(':id')
  @ApiOperation({ summary: 'Delete an invoice template' })
  remove(@Param('id', ParseUUIDPipe) id: string, @CurrentUser('workspaceId') workspaceId: string) {
    return this.templatesService.remove(id, workspaceId);
  }
}
