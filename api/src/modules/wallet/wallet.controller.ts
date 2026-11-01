import { Body, Controller, Delete, Get, Patch, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Capability, CurrentUser, CurrentUserData, PaginationDto, RequireCapability } from '../../common';
import { LinkReservedAccountDto, ProvisionReservedAccountDto, RenameReservedAccountDto, TopUpDto, WalletLedgerQueryDto } from './dto';
import { WalletService } from './wallet.service';

@ApiTags('Wallet')
@ApiBearerAuth()
@Controller('wallet')
export class WalletController {
  constructor(private readonly walletService: WalletService) {}

  @Get()
  @ApiOperation({ summary: 'Wallet health: balance, ready to send vs clearing, health status, 24h inflows, account' })
  summary(@CurrentUser('workspaceId') workspaceId: string) {
    return this.walletService.getSummary(workspaceId);
  }

  @Get('balance')
  getBalance(@CurrentUser('workspaceId') workspaceId: string) {
    return this.walletService.getBalance(workspaceId);
  }

  @Get('ledger')
  listLedger(@CurrentUser('workspaceId') workspaceId: string, @Query() filter: WalletLedgerQueryDto) {
    return this.walletService.listLedger(workspaceId, filter);
  }

  @Get('topups')
  @ApiOperation({ summary: 'Top-up history (payer, reference, amount, source)' })
  listTopups(@CurrentUser('workspaceId') workspaceId: string, @Query() pagination: PaginationDto) {
    return this.walletService.listTopups(workspaceId, pagination);
  }

  @Post('topups/reconcile')
  @RequireCapability(Capability.PAY)
  @ApiOperation({ summary: 'Back-fill missed top-up webhooks from recent Monnify transactions' })
  reconcileTopups(@CurrentUser() user: CurrentUserData) {
    return this.walletService.reconcileTopups(user.workspaceId, user);
  }

  @Post('topup')
  @RequireCapability(Capability.PAY)
  topUp(@CurrentUser('workspaceId') workspaceId: string, @Body() dto: TopUpDto) {
    return this.walletService.topUp(workspaceId, dto);
  }

  @Post('account/provision')
  @RequireCapability(Capability.ADMIN)
  provision(@CurrentUser() user: CurrentUserData, @Body() dto: ProvisionReservedAccountDto) {
    return this.walletService.provisionAccount(user.workspaceId, user, dto);
  }

  @Post('account/link')
  @RequireCapability(Capability.ADMIN)
  link(@CurrentUser() user: CurrentUserData, @Body() dto: LinkReservedAccountDto) {
    return this.walletService.linkAccount(user.workspaceId, user, dto);
  }

  @Patch('account')
  @RequireCapability(Capability.ADMIN)
  rename(@CurrentUser() user: CurrentUserData, @Body() dto: RenameReservedAccountDto) {
    return this.walletService.renameAccount(user.workspaceId, user, dto);
  }

  @Delete('account')
  @RequireCapability(Capability.ADMIN)
  unlink(@CurrentUser() user: CurrentUserData) {
    return this.walletService.unlinkAccount(user.workspaceId, user);
  }
}
