import type { RegistrationResult } from '@ocp-catalog/ocp-schema';

export function redactSavedProviderApiKey(result: RegistrationResult, savedTo: string) {
  const { provider_api_key: _providerApiKey, ...safeResult } = result;
  return {
    ...safeResult,
    provider_api_key_saved_to: savedTo,
  };
}
