import { Body, Controller, Get, HttpCode, Param, Post } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { AuthService } from './auth.service';
import { RegisterDto, LoginDto, GoogleSignInDto, EmailOnlyDto, TokenDto, SetPasswordDto, CreateWorkspaceDto } from './dto';
import { Public } from '../../common/decorators/public.decorator';
import { CurrentUser, CurrentUserData } from '../../common/decorators/current-user.decorator';

/** Spec §2 /login, /set-password. Every session-returning route returns AuthService.buildSession(). */
@ApiTags('Auth')
@Controller('auth')
export class AuthController {
  constructor(private authService: AuthService) {}

  @Public()
  @Post('register')
  @Throttle({ global: { limit: 5, ttl: 60000 } })
  register(@Body() dto: RegisterDto) {
    return this.authService.register(dto);
  }

  @Public()
  @Post('login')
  @HttpCode(200)
  @Throttle({ global: { limit: 10, ttl: 60000 } })
  login(@Body() dto: LoginDto) {
    return this.authService.login(dto);
  }

  @Public()
  @Post('google')
  @HttpCode(200)
  @Throttle({ global: { limit: 10, ttl: 60000 } })
  google(@Body() dto: GoogleSignInDto) {
    return this.authService.googleSignIn(dto);
  }

  @Public()
  @Post('forgot-password')
  @HttpCode(200)
  @Throttle({ global: { limit: 5, ttl: 60000 } })
  forgotPassword(@Body() dto: EmailOnlyDto) {
    return this.authService.forgotPassword(dto.email);
  }

  /** Alias of set-password for reset links. */
  @Public()
  @Post('reset-password')
  @HttpCode(200)
  @Throttle({ global: { limit: 10, ttl: 60000 } })
  resetPassword(@Body() dto: SetPasswordDto) {
    return this.authService.setPassword(dto);
  }

  @Public()
  @Post('resend-confirmation')
  @HttpCode(200)
  @Throttle({ global: { limit: 5, ttl: 60000 } })
  resendConfirmation(@Body() dto: EmailOnlyDto) {
    return this.authService.resendConfirmation(dto.email);
  }

  @Public()
  @Post('verify-email')
  @HttpCode(200)
  verifyEmail(@Body() dto: TokenDto) {
    return this.authService.verifyEmail(dto.token);
  }

  /** Invite / reset link details for the /set-password page. */
  @Public()
  @Get('token/:token')
  @Throttle({ global: { limit: 20, ttl: 60000 } })
  tokenInfo(@Param('token') token: string) {
    return this.authService.tokenInfo(token);
  }

  /** Accept invite (or finish reset) + set password (min 8). Single-use token. Returns a session. */
  @Public()
  @Post('set-password')
  @HttpCode(200)
  @Throttle({ global: { limit: 10, ttl: 60000 } })
  setPassword(@Body() dto: SetPasswordDto) {
    return this.authService.setPassword(dto);
  }

  /** Current session (fresh token + user + workspaces). */
  @Get('session')
  session(@CurrentUser() user: CurrentUserData) {
    return this.authService.buildSession(user.id, user.workspaceId || null, { allowNonMember: user.isPlatformAdmin });
  }

  @Get('workspaces')
  myWorkspaces(@CurrentUser() user: CurrentUserData) {
    return this.authService.listMyWorkspaces(user.id, user.workspaceId);
  }

  @Post('workspaces')
  @Throttle({ global: { limit: 5, ttl: 60000 } })
  createWorkspace(@CurrentUser() user: CurrentUserData, @Body() dto: CreateWorkspaceDto) {
    return this.authService.createWorkspace(user.id, dto.name);
  }

  @Post('switch-workspace/:workspaceId')
  @HttpCode(200)
  switchWorkspace(@CurrentUser() user: CurrentUserData, @Param('workspaceId') workspaceId: string) {
    return this.authService.switchWorkspace(user, workspaceId);
  }
}
