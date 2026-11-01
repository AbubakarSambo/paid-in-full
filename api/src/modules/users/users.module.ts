import { Module } from '@nestjs/common';
import { UsersService } from './users.service';
import { MembersService } from './members.service';
import { ProfileController, UsersController } from './users.controller';
import { AuthModule } from '../auth/auth.module';

@Module({
  imports: [AuthModule],
  controllers: [ProfileController, UsersController],
  providers: [UsersService, MembersService],
  exports: [UsersService, MembersService],
})
export class UsersModule {}
