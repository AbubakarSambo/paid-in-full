import { Controller, Headers, Logger, Post, Req } from '@nestjs/common';
import { ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { Request } from 'express';
import { Public } from '../../common';
import { MonnifyService } from './monnify.service';

@ApiTags('Monnify')
@Controller('monnify')
export class MonnifyController {
  private readonly logger = new Logger(MonnifyController.name);

  constructor(private readonly monnifyService: MonnifyService) {}

  // TODO(security): signature verification runs and logs a mismatch (see
  // MonnifyService.verifyWebhookSignature) but does not reject on mismatch — the exact
  // signed-string format Monnify uses is unconfirmed against a real delivery. Tighten this once
  // confirmed against a live sandbox/production webhook.
  @Post('webhook')
  @Public()
  @ApiOperation({ summary: "Monnify disbursement/collection webhook (signature logged, not yet enforced — see TODO)" })
  @ApiResponse({ status: 200, description: 'Webhook processed' })
  async handleWebhook(@Headers('monnify-signature') signature: string | undefined, @Req() req: Request) {
    const rawBody = (req as any).rawBody?.toString() || JSON.stringify(req.body ?? {});
    this.logger.log('Received Monnify webhook');
    return this.monnifyService.processWebhook(rawBody, signature);
  }
}
