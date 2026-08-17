import {
  Controller,
  Get,
  Query,
  HttpCode,
  HttpStatus,
  ParseUUIDPipe,
} from '@nestjs/common';
import { Public } from '../../access-control/decorators/public.decorator';
import { AvailabilityApplicationService } from '@jc-barberia/application';
import type { AvailabilityOutput } from '@jc-barberia/contracts';

@Controller()
export class AvailabilityController {
  constructor(
    private readonly availability: AvailabilityApplicationService,
  ) {}

  @Get('availability')
  @HttpCode(HttpStatus.OK)
  @Public()
  async getAvailability(