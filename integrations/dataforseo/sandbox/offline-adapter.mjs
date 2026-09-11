export class OfflineDataForSeoAdapter {
  constructor({network_enabled = false, transport = null} = {}) {
    if (network_enabled !== false) throw new Error('SANDBOX_NETWORK_ENABLE_FORBIDDEN_IN_PREINTEGRATION');
    if (transport !== null) throw new Error('TRANSPORT_INJECTION_FORBIDDEN_IN_PREINTEGRATION');
  }
  async submit() { throw new Error('DATAFORSEO_NETWORK_DISABLED'); }
}
