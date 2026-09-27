import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { paginate, PaginationDto } from '../../common';
import { CreateClientErrorDto } from './dto/create-client-error.dto';

@Injectable()
export class ClientErrorsService {
  constructor(private readonly prisma: PrismaService) {}

  async create(dto: CreateClientErrorDto) {
    return this.prisma.clientError.create({ data: dto });
  }

  async list(query: PaginationDto) {
    const page = query.page ?? 1;
    const limit = query.limit ?? 20;

    const [data, total] = await Promise.all([
      this.prisma.clientError.findMany({
        skip: (page - 1) * limit,
        take: limit,
        orderBy: { createdAt: 'desc' },
      }),
      this.prisma.clientError.count(),
    ]);

    return paginate(data, total, page, limit);
  }
}
