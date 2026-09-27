import { Body, Controller, Delete, Get, Param, ParseUUIDPipe, Patch, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '../../common';
import { CreateVendorDto, UpdateVendorDto, VendorQueryDto, VerifyAccountDto } from './dto';
import { VendorsService } from './vendors.service';

@ApiTags('Vendors')
@ApiBearerAuth()
@Controller('vendors')
export class VendorsController {
  constructor(private readonly vendorsService: VendorsService) {}

  @Get()
  list(@CurrentUser('workspaceId') workspaceId: string, @Query() query: VendorQueryDto) {
    return this.vendorsService.list(workspaceId, query);
  }

  @Get('banks')
  listBanks() {
    return this.vendorsService.listBanks();
  }

  @Post('verify-account')
  verifyAccount(@Body() dto: VerifyAccountDto) {
    return this.vendorsService.verifyAccount(dto);
  }

  @Post()
  create(@CurrentUser('workspaceId') workspaceId: string, @Body() dto: CreateVendorDto) {
    return this.vendorsService.create(workspaceId, dto);
  }

  @Get(':id')
  findOne(@CurrentUser('workspaceId') workspaceId: string, @Param('id', ParseUUIDPipe) id: string) {
    return this.vendorsService.findOne(workspaceId, id);
  }

  @Patch(':id')
  update(
    @CurrentUser('workspaceId') workspaceId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateVendorDto,
  ) {
    return this.vendorsService.update(workspaceId, id, dto);
  }

  @Delete(':id')
  remove(@CurrentUser('workspaceId') workspaceId: string, @Param('id', ParseUUIDPipe) id: string) {
    return this.vendorsService.remove(workspaceId, id);
  }
}
