// Node bindings; the portable engine is shared with the browser worker.
import {createRequire} from 'node:module';
import {paymentEngine} from '../../protocol/payment-engine.js';
export const sdk=createRequire(import.meta.url)('../../vendor/kaspa/kaspa.js');
export const {prepareTestnetPayment,requiredFeeForReview,validateSignedPaymentShape,validateSignedPaymentSignatures}=paymentEngine(sdk);
