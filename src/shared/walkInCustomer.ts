/**
 * What a sale records when nobody gave their details.
 *
 * Both ends of the app need these and they have to agree: the checkout
 * modal's Quick Mode writes them when the cashier declares a walk-in, and
 * `orders:close` writes them when a ticket is closed without ever passing
 * through checkout. Two copies of the literals would drift, and the drift
 * would be invisible — it only shows up as two shapes of anonymous customer
 * in the back office months later.
 *
 * These deliberately do NOT identify the operator. That was the old
 * behaviour: the cashier's own name and personal mobile were stored as the
 * customer on every walk-in sale, because filling the customer field was the
 * only way the operator reached the server at all. The operator now travels
 * as `server_user_id` on the push, in a column built for it that reports can
 * group by, so the smuggling route costs a junk customer record per sale and
 * buys nothing.
 */
export const WALK_IN_CUSTOMER_NAME = 'POS Customer';

/** A recognisable non-number, not a real subscriber. */
export const WALK_IN_CUSTOMER_MOBILE = '55555555';
