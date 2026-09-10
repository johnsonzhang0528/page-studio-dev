import { createBillingDispatchOutbox } from './billing-dispatch-outbox.mjs';
import { createBillingEgressAssertionAuthority } from './billing-egress-assertion.mjs';
import { createBillingFirewall } from './billing-firewall.mjs';
import { createBillingGatewayAuthorizer } from './billing-gateway-authorizer.mjs';
import { createBillingGatewayCredentialAuthority } from './billing-gateway-credential.mjs';
import { createBillingGatewayHandler } from './billing-gateway-handler.mjs';
import { createOpenAiResponsesAdapter } from './openai-adapter.mjs';
import { createOpenAiResponsesEgressTransport } from './openai-responses-egress-transport.mjs';
import { createCapabilityRegistry } from './provider-capabilities.mjs';
import { createPriceRegistry } from './price-registry.mjs';

const fail=message=>Object.assign(new Error(message),{code:'BILLING_GATEWAY_RUNTIME_INVALID'});

export function createBillingGatewayRuntime({root,policy,billing_policy,price_registry,capability_registry,gateway_credential_secret,egress_assertion_secret,egressClient,controller_credential_policy,clock=()=>Date.now()}={}){
  if(!root||!policy||!billing_policy||!price_registry||!capability_registry||!gateway_credential_secret||!egress_assertion_secret||!egressClient)throw fail('BILLING_GATEWAY_RUNTIME_CONFIG_REQUIRED');
  const prices=createPriceRegistry(price_registry),capabilities=createCapabilityRegistry(capability_registry),firewall=createBillingFirewall({root,priceRegistry:prices,policy:billing_policy,clock}),outbox=createBillingDispatchOutbox({root,clock}),billingAuthorizer=createBillingGatewayAuthorizer({firewall,outbox}),credentialAuthority=createBillingGatewayCredentialAuthority({secret:gateway_credential_secret,clock,controller_credential_policy}),assertionAuthority=createBillingEgressAssertionAuthority({secret:egress_assertion_secret,clock}),transport=createOpenAiResponsesEgressTransport({egressClient,assertionAuthority}),adapter=createOpenAiResponsesAdapter({registry:capabilities,transport,offline:false,billingAuthorizer}),handler=createBillingGatewayHandler({policy,credentialAuthority,billingAuthorizer,adapter,clock});
  return Object.freeze({handler,firewall,outbox});
}
