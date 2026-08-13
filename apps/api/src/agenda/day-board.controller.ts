import { Controller, Get, Query } from '@nestjs/common';
import { GetDayBoardUseCase } from '@jc-barberia/application';
import type { DayBoardResponse } from '@jc-barberia/contracts';
import type { ActorContext } from '@jc-barberia/domain';

import { CurrentActor } from '../access-control/decorators/current-actor.decorator';
import { RequiresPermission } from '../access-control/decorators/requires-permission.decorator';

/**
 * Task 8.3/8.4's "endpoint del día": returns `allowedActions` per slot,
 * computed server-side by `GetDayBoardUseCase` from the resolved
 * `ActorContext` — never from a `barberId` path/query parameter a caller
 * could tamper with. Reachable by either `agenda:read:any` (owner/secretary)
 * or `agenda:read:own` (barber); which columns/slots come back is entirely
 * `DayBoardRepository`'s narrowing (task 8.7/8.8), not this handler's job.
 */
@Controller('agenda')
export class DayBoardController {
  constructor(private readonly getDayBoard: GetDayBoardUseCase) {}

  @RequiresPermission('agenda:read:any', 'agenda:read:own')
  @Get('day-board')
  dayBoard(@Query('date') date: string, @CurrentActor() actor: ActorContext): Promise<DayBoardResponse> {
    return this.getDayBoard.execute(date, actor);
  }
}
