export type {
  AuthChallenge,
  AuthChallengePurpose,
  AuthChallengeRepository,
  ConsumeChallengeResult,
} from './auth-challenge';
export { CHALLENGE_EXPIRY_MINUTES, MAX_CHALLENGE_ATTEMPTS } from './auth-challenge';
export { FakeAuthChallengeRepository } from './testing/fake-auth-challenge-repository';
export type { RecordedConsumeCall } from './testing/fake-auth-challenge-repository';
export type { PasswordHasher } from './password-hasher';
export { MIN_PASSWORD_LENGTH, WeakPasswordError, assertValidPassword } from './password-hasher';
export type { UserCredentials, UserCredentialsRepository } from './user-credentials';
export { FakePasswordHasher } from './testing/fake-password-hasher';
export { FakeUserCredentialsRepository } from './testing/fake-user-credentials-repository';
export type { FakeUser } from './testing/fake-user-credentials-repository';
