import { Module } from '@nestjs/common';
import { GetDayBoardUseCase } from '@jc-barberia/application';
import { db, DrizzleDayBoardRepository, ShopClock } from '@jc-barberia/infrastructure';
import type { DayBoardRepository, RolePermissionRepository } from '@jc-barberia/domain';

import { AccessControlModule } from '../access-control/access-control.module';
import { ROLE_PERMISSION_REPOSITORY } from '../access-control/tokens';
import { DayBoardController } from './day-board.controller';
import { DAY_BOARD_REPOSITORY } from './tokens';

/** Wires the day board's real endpoint (task 8.3/8.4): binds
 *  `DayBoardRepository` to its Postgres-backed adapter and reuses
 *  `AccessControlModule`'s already-bound `RolePermissionRepository` — never
 *  a second instance registered under a different token. */
@Module({
  imports: [AccessControlModule],
  controllers: [DayBoardController],
  providers: [
    {
      provide: DAY_BOARD_REPOSITORY,
      useFactory: () => new DrizzleDayBoardRepository(db, new ShopClock()),
    },
    {
      provide: GetDayBoardUseCase,
      inject: [DAY_BOARD_REPOSITORY, ROLE_PERMISSION_REPOSITORY],
      useFactory: (dayBoardRepository: DayBoardRepository, rolePermissions: RolePermissionRepository) =>
        new GetDayBoardUseCase(dayBoardRepository, rolePermissions),
    },
  ],
})
export class AgendaModule {}
