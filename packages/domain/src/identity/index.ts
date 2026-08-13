export type {
  AuthChallenge,
  AuthChallengePurpose,
  AuthChallengeRepository,
  ConsumeChallengeResult,
} from './auth-challenge';
export { CHALLENGE_EXPIRY_MINUTES, MAX_CHALLENGE_ATTEMPTS } from './auth-challenge';
export { FakeAuthChallengeRepository } from './testing/fake-auth-challenge-repository';
export type { RecordedConsumeCall } from './testing/fake-auth-challenge-repository';
