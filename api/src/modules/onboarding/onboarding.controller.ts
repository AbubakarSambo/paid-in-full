import { Body, Controller, Get, HttpCode, Param, Patch, Post } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { Capability, CurrentUser, CurrentUserData, RequireCapability } from '../../common';
import { OnboardingService } from './onboarding.service';
import { ChecklistDismissDto, ChecklistStepDto, OnboardingWizardDto } from './dto';

@ApiTags('Workspaces')
@Controller('onboarding')
export class OnboardingController {
  constructor(private readonly onboarding: OnboardingService) {}

  @Post('wizard')
  @HttpCode(200)
  @RequireCapability(Capability.ADMIN)
  wizard(@CurrentUser() user: CurrentUserData, @Body() dto: OnboardingWizardDto) {
    return this.onboarding.runWizard(user, dto);
  }

  @Get('checklist')
  @RequireCapability(Capability.VIEW)
  checklist(@CurrentUser() user: CurrentUserData) {
    return this.onboarding.checklist(user.workspaceId);
  }

  @Patch('checklist/:key')
  @RequireCapability(Capability.ADMIN)
  setStep(@CurrentUser() user: CurrentUserData, @Param('key') key: string, @Body() dto: ChecklistStepDto) {
    return this.onboarding.setStep(user, key, dto.done);
  }

  @Post('checklist/dismiss')
  @HttpCode(200)
  @RequireCapability(Capability.ADMIN)
  dismiss(@CurrentUser() user: CurrentUserData, @Body() dto: ChecklistDismissDto) {
    return this.onboarding.dismiss(user, dto.dismissed);
  }
}
