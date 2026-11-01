import { Body, Controller, Get, HttpCode, Post, Put } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { CurrentUser, CurrentUserData } from '../../common';
import { SecurityService } from './security.service';
import { ResetPinDto, SetPinDto, VerifyPinDto } from './dto';

/** "Vendor Disbursements" settings section: my disbursement PIN. Any signed-in member. */
@ApiTags('Users')
@Controller('me/pin')
export class SecurityController {
  constructor(private readonly security: SecurityService) {}

  @Get()
  status(@CurrentUser() user: CurrentUserData) {
    return this.security.pinStatus(user.id);
  }

  @Put()
  @Throttle({ global: { limit: 10, ttl: 60000 } })
  setPin(@CurrentUser() user: CurrentUserData, @Body() dto: SetPinDto) {
    return this.security.setPin(user.id, user.workspaceId || null, dto.pin, dto.currentPin);
  }

  @Post('reset')
  @Throttle({ global: { limit: 5, ttl: 60000 } })
  reset(@CurrentUser() user: CurrentUserData, @Body() dto: ResetPinDto) {
    return this.security.resetPin(user.id, user.workspaceId || null, dto.password, dto.pin);
  }

  /** Lets the UI pre-check a PIN before a disbursement confirm step. */
  @Post('verify')
  @HttpCode(200)
  @Throttle({ global: { limit: 10, ttl: 60000 } })
  async verify(@CurrentUser() user: CurrentUserData, @Body() dto: VerifyPinDto) {
    await this.security.verifyPin(user.id, dto.pin);
    return { ok: true };
  }
}
