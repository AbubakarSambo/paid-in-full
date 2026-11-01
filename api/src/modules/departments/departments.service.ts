import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { CreateDepartmentDto, UpdateDepartmentDto } from './dto';

/** Suggestions offered when typing a department (free text). */
export const COMMON_DEPARTMENTS = [
  'Operations',
  'Finance',
  'Admin',
  'Human Resources',
  'Procurement',
  'Kitchen',
  'Bar',
  'Housekeeping',
  'Front Office',
  'Maintenance',
  'Security',
  'Sales & Marketing',
  'IT',
  'Logistics',
  'Facilities',
  'Management',
];

@Injectable()
export class DepartmentsService {
  constructor(private prisma: PrismaService) {}

  async findAll(workspaceId: string, opts: { activeOnly?: boolean } = {}) {
    return this.prisma.department.findMany({
      where: { workspaceId, ...(opts.activeOnly && { isActive: true }) },
      orderBy: { name: 'asc' },
    });
  }

  /** Workspace departments first, then common names not yet used; filtered by `q`. */
  async suggestions(workspaceId: string, q?: string) {
    const existing = await this.prisma.department.findMany({ where: { workspaceId, isActive: true }, select: { id: true, name: true }, orderBy: { name: 'asc' } });
    const needle = (q ?? '').trim().toLowerCase();
    const match = (n: string) => !needle || n.toLowerCase().includes(needle);
    const have = new Set(existing.map((d) => d.name.toLowerCase()));
    return [
      ...existing.filter((d) => match(d.name)).map((d) => ({ id: d.id, name: d.name, existing: true })),
      ...COMMON_DEPARTMENTS.filter((n) => !have.has(n.toLowerCase()) && match(n)).map((n) => ({ id: null, name: n, existing: false })),
    ].slice(0, 20);
  }

  /**
   * Free-text department: returns the matching department (case-insensitive), creating it
   * (or reactivating it) when missing. For use by requisitions. Empty name → null.
   */
  async ensureByName(workspaceId: string, name: string | null | undefined, client: Pick<PrismaService, 'department'> = this.prisma) {
    const clean = (name ?? '').replace(/\s+/g, ' ').trim().slice(0, 255);
    if (!clean) return null;
    const hit = await client.department.findFirst({ where: { workspaceId, name: { equals: clean, mode: 'insensitive' } } });
    if (hit) return hit.isActive ? hit : client.department.update({ where: { id: hit.id }, data: { isActive: true } });
    try {
      return await client.department.create({ data: { workspaceId, name: clean } });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        return client.department.findFirst({ where: { workspaceId, name: { equals: clean, mode: 'insensitive' } } });
      }
      throw error;
    }
  }

  async create(workspaceId: string, dto: CreateDepartmentDto) {
    try {
      return await this.prisma.department.create({
        data: { workspaceId, name: dto.name.replace(/\s+/g, ' ').trim() },
      });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        throw new ConflictException('A department with this name already exists');
      }
      throw error;
    }
  }

  async update(workspaceId: string, id: string, dto: UpdateDepartmentDto) {
    const existing = await this.prisma.department.findFirst({ where: { id, workspaceId } });
    if (!existing) {
      throw new NotFoundException('Department not found');
    }

    try {
      return await this.prisma.department.update({
        where: { id },
        data: {
          ...(dto.name !== undefined && { name: dto.name }),
          ...(dto.isActive !== undefined && { isActive: dto.isActive }),
        },
      });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        throw new ConflictException('A department with this name already exists');
      }
      throw error;
    }
  }

  async remove(workspaceId: string, id: string) {
    const existing = await this.prisma.department.findFirst({ where: { id, workspaceId } });
    if (!existing) {
      throw new NotFoundException('Department not found');
    }

    await this.prisma.department.update({
      where: { id },
      data: { isActive: false },
    });

    return { success: true };
  }
}
