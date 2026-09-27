import { Controller, Get, Post, Body, Query, UseGuards } from '@nestjs/common';
import { ApiTags, ApiOperation } from '@nestjs/swagger';
import { ClientErrorsService } from './client-errors.service';
import { CreateClientErrorDto } from './dto';
import { Public, PlatformAdminGuard, PaginationDto } from '../../common';

@ApiTags('Platform')
@Controller('client-errors')
export class ClientErrorsController {
  constructor(private readonly clientErrorsService: ClientErrorsService) {}

  @Public()
  @Post()
  @ApiOperation({ summary: 'Record a frontend error caught by the client app (public, unauthenticated)' })
  async create(@Body() dto: CreateClientErrorDto) {
    return this.clientErrorsService.create(dto);
  }

  @UseGuards(PlatformAdminGuard)
  @Get()
  @ApiOperation({ summary: 'Paginated list of client errors (platform admin only)' })
  async list(@Query() query: PaginationDto) {
    return this.clientErrorsService.list(query);
  }
}
