import { Body, Controller, Delete, Get, Param, ParseUUIDPipe, Patch, Post, Query, Res } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiQuery, ApiTags } from '@nestjs/swagger';
import { Response } from 'express';
import { Capability, CurrentUser, CurrentUserData, RequireCapability } from '../../common';
import { BulkVendorCsvDto, CreateVendorDto, UpdateVendorDto, VendorQueryDto, VerifyAccountDto } from './dto';
import { VendorsService } from './vendors.service';

@ApiTags('Vendors')
@ApiBearerAuth()
@Controller('vendors')
export class VendorsController {
  constructor(private readonly vendorsService: VendorsService) {}

  @Get()
  @ApiOperation({ summary: 'List vendors; search name/bank/account/contact/TIN/tag, filter by tag' })
  list(@CurrentUser('workspaceId') workspaceId: string, @Query() query: VendorQueryDto) {
    return this.vendorsService.list(workspaceId, query);
  }

  @Get('banks')
  @ApiOperation({ summary: 'Nigerian banks with CBN/NIP codes' })
  listBanks() {
    return this.vendorsService.listBanks();
  }

  @Get('tags')
  @ApiOperation({ summary: 'Vendor tags with counts (most used first)' })
  tags(@CurrentUser('workspaceId') workspaceId: string) {
    return this.vendorsService.tags(workspaceId);
  }

  @Get('missing-info')
  @ApiOperation({ summary: '"No TIN / phone" — active vendors missing a TIN or phone, with count' })
  missingInfo(@CurrentUser('workspaceId') workspaceId: string) {
    return this.vendorsService.missingInfo(workspaceId);
  }

  @Get('template.csv')
  template(@Res() res: Response) {
    res.set({ 'Content-Type': 'text/csv', 'Content-Disposition': 'attachment; filename="vendors-template.csv"' });
    res.send(this.vendorsService.templateCsv());
  }

  @Get('export.csv')
  @ApiQuery({ name: 'search', required: false })
  @ApiQuery({ name: 'tag', required: false })
  async exportCsv(@CurrentUser('workspaceId') workspaceId: string, @Res() res: Response, @Query('search') search?: string, @Query('tag') tag?: string) {
    const csv = await this.vendorsService.exportCsv(workspaceId, { search, tag });
    res.set({ 'Content-Type': 'text/csv', 'Content-Disposition': 'attachment; filename="vendors.csv"' });
    res.send(csv);
  }

  @Get('export.pdf')
  @ApiQuery({ name: 'search', required: false })
  @ApiQuery({ name: 'tag', required: false })
  async exportPdf(@CurrentUser('workspaceId') workspaceId: string, @Res() res: Response, @Query('search') search?: string, @Query('tag') tag?: string) {
    const pdf = await this.vendorsService.exportPdf(workspaceId, { search, tag });
    res.set({ 'Content-Type': 'application/pdf', 'Content-Disposition': 'attachment; filename="vendors.pdf"' });
    res.send(pdf);
  }

  @Post('verify-account')
  @RequireCapability(Capability.POST, Capability.REQUEST)
  @ApiOperation({ summary: 'Bank name enquiry (Monnify validate-account)' })
  verifyAccount(@Body() dto: VerifyAccountDto) {
    return this.vendorsService.verifyAccount(dto);
  }

  @Post('bulk/preview')
  @RequireCapability(Capability.POST)
  @ApiOperation({ summary: 'Bulk CSV preview: verifies every row with the bank; only name-matching rows are importable' })
  bulkPreview(@CurrentUser('workspaceId') workspaceId: string, @Body() dto: BulkVendorCsvDto) {
    return this.vendorsService.bulkPreview(workspaceId, dto.csv);
  }

  @Post('bulk/commit')
  @RequireCapability(Capability.POST)
  @ApiOperation({ summary: 'Bulk CSV import: re-verifies server-side and creates only name-matching rows' })
  bulkCommit(@CurrentUser() user: CurrentUserData, @Body() dto: BulkVendorCsvDto) {
    return this.vendorsService.bulkCommit(user.workspaceId, dto.csv, user);
  }

  @Post()
  @RequireCapability(Capability.POST)
  @ApiOperation({ summary: 'Register a vendor (audit: vendor.created)' })
  create(@CurrentUser() user: CurrentUserData, @Body() dto: CreateVendorDto) {
    return this.vendorsService.create(user.workspaceId, dto, user);
  }

  @Get(':id')
  findOne(@CurrentUser('workspaceId') workspaceId: string, @Param('id', ParseUUIDPipe) id: string) {
    return this.vendorsService.findOne(workspaceId, id);
  }

  @Post(':id/recheck')
  @RequireCapability(Capability.POST)
  @ApiOperation({ summary: 'Re-run the bank name enquiry for a saved vendor' })
  recheck(@CurrentUser() user: CurrentUserData, @Param('id', ParseUUIDPipe) id: string) {
    return this.vendorsService.recheck(user.workspaceId, id, user);
  }

  @Patch(':id')
  @RequireCapability(Capability.POST)
  @ApiOperation({ summary: 'Edit a vendor (audit: vendor.updated)' })
  update(@CurrentUser() user: CurrentUserData, @Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateVendorDto) {
    return this.vendorsService.update(user.workspaceId, id, dto, user);
  }

  @Delete(':id')
  @RequireCapability(Capability.ADMIN)
  @ApiOperation({ summary: 'Delete a vendor (admin; deactivates instead if it has history)' })
  remove(@CurrentUser() user: CurrentUserData, @Param('id', ParseUUIDPipe) id: string) {
    return this.vendorsService.remove(user.workspaceId, id, user);
  }
}
