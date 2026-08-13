import { SetMetadata } from '@nestjs/common';

export const IS_PUBLIC_KEY = 'access-control:is-public';

/**
 * Explicit opt-out of `PermissionsGuard`'s deny-by-default check. This is
 * the ONLY way a handler may skip `@RequiresPermission(...)` — silence (no
 * decorator at all) is a rejection, never an implicit public route (see
 * access-control spec, "Tres roles con aplicación en el backend").
 */
export const Public = (): MethodDecorator & ClassDecorator => SetMetadata(IS_PUBLIC_KEY, true);
