/**
 * The complete set of Mongoose models.
 *
 * Why this file exists
 * --------------------
 * Index creation happens at connection time, but Mongoose only knows about
 * a model once its module has been imported and `mongoose.model()` has run.
 * If index provisioning walked `mongoose.models`, it would find whatever had
 * been imported so far — which depends on import order and can easily be
 * nothing at all.
 *
 * The result is a silent failure: the process starts, the database is
 * reachable, and the unique index that backs the email outbox's
 * exactly-once guarantee simply is not there. Nothing errors. Duplicate
 * customer emails go out.
 *
 * So the model list is explicit. Importing this module registers every
 * model as a side effect, and `models()` returns them all. Adding a model
 * means adding it here — one line, and impossible to forget silently.
 */

/* Catalogue and merchandising. */
import '../models/product.model.js';
import '../models/variant.model.js';
import '../models/category.model.js';
import '../models/banner.model.js';
import '../models/homepage-section.model.js';
import '../models/content-block.model.js';
import '../models/image-review.model.js';

/* Commerce. */
import '../models/cart.model.js';
import '../models/order.model.js';
import '../models/return-request.model.js';
import '../models/stock-movement.model.js';
import '../models/coupon.model.js';

/* Money. */
import '../models/payment.model.js';

/* Fulfilment. */
import '../models/shipment.model.js';

/* Identity and access. */
import '../models/user.model.js';
import '../models/admin-user.model.js';
import '../models/refresh-token.model.js';

/* Platform plumbing. */
import '../models/webhook-event.model.js';
import '../models/email-log.model.js';
import '../models/idempotency.model.js';
import '../models/audit-log.model.js';
import '../models/activity-event.model.js';
import '../models/store-settings.model.js';
import '../models/import-plan.model.js';
