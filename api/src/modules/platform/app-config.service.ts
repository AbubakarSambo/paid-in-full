import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { UpsertAppConfigDto } from './dto/upsert-app-config.dto';

@Injectable()
export class AppConfigAdminService {
  constructor(private readonly prisma: PrismaService) {}

  async list() {
    return this.prisma.platformConfig.findMany({ orderBy: { key: 'asc' } });
  }

  async upsert(dto: UpsertAppConfigDto) {
    return this.prisma.platformConfig.upsert({
      where: { key: dto.key },
      create: { key: dto.key, value: dto.value ?? null },
      update: { value: dto.value ?? null },
    });
  }
}
