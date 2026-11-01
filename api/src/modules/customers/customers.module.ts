import { Module } from '@nestjs/common';
import { CustomersService } from './customers.service';
import { CustomersController, CustomerCreditsController } from './customers.controller';

@Module({
  controllers: [CustomersController, CustomerCreditsController],
  providers: [CustomersService],
  exports: [CustomersService],
})
export class CustomersModule {}
