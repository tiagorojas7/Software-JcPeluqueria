import { Module } from '@nestjs/common';
import { AccessControlModule } from '../access-control/access-control.module';
import { ListBarberAppointmentsUseCase } from '@jc-barberia/application';
import { BarberController } from './appointments.controller';

@Module({
  imports: [AccessControlModule],
  controllers: [BarberController],
  providers: [
    {
      provide: ListBarberAppointmentsUseCase,
      useClass: ListBarberAppointmentsUseCase,
    },
  ],
})
export class BarberModule {}