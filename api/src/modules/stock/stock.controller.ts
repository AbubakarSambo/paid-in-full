import { Body, Controller, Delete, Get, Param, ParseUUIDPipe, Patch, Post, Query, Res } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Response } from 'express';
import { Capability, CurrentUser, CurrentUserData, RequireCapability } from '../../common';
import { CreateStockExpenseDto, ImportStockCsvDto, StockQueryDto, UpdateStockExpenseDto } from './dto';
import { StockService } from './stock.service';

@ApiTags('Stock Expenses')
@ApiBearerAuth()
@Controller('stock')
export class StockController {
  constructor(private readonly stock: StockService) {}

  @Get()
  @ApiOperation({ summary: 'List / search stock items (active=true for the picker)' })
  list(@CurrentUser('workspaceId') workspaceId: string, @Query() query: StockQueryDto) {
    return this.stock.list(workspaceId, query);
  }

  @Get('template.csv')
  template(@Res() res: Response) {
    res.set({ 'Content-Type': 'text/csv', 'Content-Disposition': 'attachment; filename="stock-template.csv"' });
    res.send(this.stock.templateCsv());
  }

  @Post('import')
  @RequireCapability(Capability.POST)
  @ApiOperation({ summary: 'Import stock items from CSV (upsert by name)' })
  importCsv(@CurrentUser() user: CurrentUserData, @Body() dto: ImportStockCsvDto) {
    return this.stock.importCsv(user.workspaceId, dto, user);
  }

  @Post()
  @RequireCapability(Capability.POST)
  create(@CurrentUser() user: CurrentUserData, @Body() dto: CreateStockExpenseDto) {
    return this.stock.create(user.workspaceId, dto, user);
  }

  @Get(':id')
  findOne(@CurrentUser('workspaceId') workspaceId: string, @Param('id', ParseUUIDPipe) id: string) {
    return this.stock.findOne(workspaceId, id);
  }

  @Patch(':id')
  @RequireCapability(Capability.POST)
  update(@CurrentUser() user: CurrentUserData, @Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateStockExpenseDto) {
    return this.stock.update(user.workspaceId, id, dto, user);
  }

  @Delete(':id')
  @RequireCapability(Capability.POST)
  remove(@CurrentUser() user: CurrentUserData, @Param('id', ParseUUIDPipe) id: string) {
    return this.stock.remove(user.workspaceId, id, user);
  }
}
