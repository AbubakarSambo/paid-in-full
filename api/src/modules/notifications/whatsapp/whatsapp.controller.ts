import { Body, Controller, ForbiddenException, Get, HttpStatus, Logger, Post, Query, Res } from '@nestjs/common';
import { ApiExcludeController } from '@nestjs/swagger';
import { Response } from 'express';
import { Public } from '../../../common/decorators/public.decorator';
import { WhatsAppService } from './whatsapp.service';

@ApiExcludeController()
@Controller('whatsapp')
export class WhatsAppController {
  private readonly logger = new Logger(WhatsAppController.name);

  constructor(private whatsAppService: WhatsAppService) {}

  // @Res() bypasses the global response envelope - Meta requires the raw challenge value
  // as the response body, not JSON.
  @Public()
  @Get('webhook')
  verifyWebhook(
    @Query('hub.mode') mode: string,
    @Query('hub.verify_token') verifyToken: string,
    @Query('hub.challenge') challenge: string,
    @Res() res: Response,
  ) {
    if (mode !== 'subscribe' || !this.whatsAppService.isValidVerifyToken(verifyToken)) {
      throw new ForbiddenException('Invalid verify token');
    }
    res.status(HttpStatus.OK).send(challenge);
  }

  // Meta expects a fast 200 regardless of processing outcome.
  @Public()
  @Post('webhook')
  async receiveWebhook(@Body() payload: any) {
    try {
      await this.whatsAppService.handleWebhookEvent(payload);
    } catch (error) {
      this.logger.error('Failed to process WhatsApp webhook event', error as Error);
    }
    return { received: true };
  }
}
