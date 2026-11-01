import { Body, Controller, Delete, Get, Put } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Capability, CurrentUser, CurrentUserData, RequireCapability } from '../../common';
import { InvoiceSettingsDto, PaymentAccountDto, SweepSettingsDto } from './dto';
import { InvoiceSettingsService } from './invoice-settings.service';

@ApiTags('Invoice Settings')
@ApiBearerAuth()
@RequireCapability(Capability.INVOICE)
@Controller('invoice-settings')
export class InvoiceSettingsController {
  constructor(private readonly settings: InvoiceSettingsService) {}

  @Get()
  @ApiOperation({ summary: 'Invoice branding, numbering prefixes, VAT default, default terms and payment account' })
  get(@CurrentUser('workspaceId') workspaceId: string) {
    return this.settings.get(workspaceId);
  }

  @Put()
  @ApiOperation({ summary: 'Update invoice branding (logo, signature, theme hex, footer), prefixes, VAT default, terms' })
  update(@CurrentUser() user: CurrentUserData, @Body() dto: InvoiceSettingsDto) {
    return this.settings.update(user, dto);
  }

  @Put('payment-account')
  @ApiOperation({ summary: 'Set the invoice payment (revenue) account; verified by bank name enquiry' })
  setPaymentAccount(@CurrentUser() user: CurrentUserData, @Body() dto: PaymentAccountDto) {
    return this.settings.setPaymentAccount(user, dto);
  }

  @Delete('payment-account')
  @ApiOperation({ summary: 'Remove the invoice payment account' })
  clearPaymentAccount(@CurrentUser() user: CurrentUserData) {
    return this.settings.clearPaymentAccount(user);
  }

  @Get('sweep')
  @RequireCapability(Capability.ADMIN)
  @ApiOperation({ summary: 'Invoice collections auto-sweep settings (admin)' })
  getSweep(@CurrentUser('workspaceId') workspaceId: string) {
    return this.settings.getSweep(workspaceId);
  }

  @Put('sweep')
  @RequireCapability(Capability.ADMIN)
  @ApiOperation({ summary: 'Update auto-sweep: enabled, destination bank/account (verified), buffer (admin)' })
  updateSweep(@CurrentUser() user: CurrentUserData, @Body() dto: SweepSettingsDto) {
    return this.settings.updateSweep(user, dto);
  }
}
