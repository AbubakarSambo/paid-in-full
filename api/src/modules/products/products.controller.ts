import { Body, Controller, Delete, Get, Param, ParseUUIDPipe, Patch, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Capability, CurrentUser, RequireCapability } from '../../common';
import { CreateProductDto, ProductFilterDto, UpdateProductDto } from './dto';
import { ProductsService } from './products.service';

@ApiTags('Products')
@ApiBearerAuth()
@RequireCapability(Capability.INVOICE)
@Controller('products')
export class ProductsController {
  constructor(private readonly products: ProductsService) {}

  @Get()
  @ApiOperation({ summary: 'List products (search, active filter)' })
  findAll(@CurrentUser('workspaceId') workspaceId: string, @Query() filter: ProductFilterDto) {
    return this.products.findAll(workspaceId, filter);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get a product' })
  findOne(@Param('id', ParseUUIDPipe) id: string, @CurrentUser('workspaceId') workspaceId: string) {
    return this.products.findOne(workspaceId, id);
  }

  @Post()
  @ApiOperation({ summary: 'Create a product (name, description, sku, unitName, unitPrice, taxRate, active)' })
  create(@Body() dto: CreateProductDto, @CurrentUser('workspaceId') workspaceId: string) {
    return this.products.create(workspaceId, dto);
  }

  @Patch(':id')
  @ApiOperation({ summary: 'Update a product' })
  update(@Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateProductDto, @CurrentUser('workspaceId') workspaceId: string) {
    return this.products.update(workspaceId, id, dto);
  }

  @Delete(':id')
  @ApiOperation({ summary: 'Delete a product' })
  remove(@Param('id', ParseUUIDPipe) id: string, @CurrentUser('workspaceId') workspaceId: string) {
    return this.products.remove(workspaceId, id);
  }
}
