import { Body, Controller, Get, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '../../common';
import { TopUpDto, WalletLedgerQueryDto } from './dto';
import { WalletService } from './wallet.service';

@ApiTags('Wallet')
@ApiBearerAuth()
@Controller('wallet')
export class WalletController {
  constructor(private readonly walletService: WalletService) {}

  @Get('balance')
  getBalance(@CurrentUser('workspaceId') workspaceId: string) {
    return this.walletService.getBalance(workspaceId);
  }

  @Get('ledger')
  listLedger(@CurrentUser('workspaceId') workspaceId: string, @Query() filter: WalletLedgerQueryDto) {
    return this.walletService.listLedger(workspaceId, filter);
  }

  @Post('topup')
  topUp(@CurrentUser('workspaceId') workspaceId: string, @Body() dto: TopUpDto) {
    return this.walletService.topUp(workspaceId, dto);
  }
}
