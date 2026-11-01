import { IsEmail, IsEnum, IsOptional, IsString } from 'class-validator';
import { Role } from '../../../common/decorators/roles.decorator';

export class InviteMemberDto {
  @IsEmail()
  email: string;

  @IsEnum(Role)
  role: Role;

  @IsOptional()
  @IsString()
  name?: string;
}
