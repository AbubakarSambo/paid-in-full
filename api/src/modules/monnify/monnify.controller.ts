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

  // Signature: `monnify-signature` = HMAC-SHA512(secret key, raw body). Rejected with 401 unless it
  // matches (MonnifyService.enforceWebhookSignature); outcomes of unsigned events are re-verified
  // against Monnify's API even when enforcement is switched off.
  @Post('webhook')
  @Public()
  @ApiOperation({ summary: "Monnify disbursement/collection webhook (HMAC-SHA512 signature required)" })
  @ApiResponse({ status: 200, description: 'Webhook processed' })
  @ApiResponse({ status: 401, description: 'Missing or invalid monnify-signature' })
  async handleWebhook(@Headers('monnify-signature') signature: string | undefined, @Req() req: Request) {
    const rawBody = (req as any).rawBody?.toString() || JSON.stringify(req.body ?? {});
    this.logger.log('Received Monnify webhook');
    return this.monnifyService.processWebhook(rawBody, signature);
  }
}
