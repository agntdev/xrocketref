# Referral Payout Tracker — Bot specification

**Archetype:** custom

**Voice:** professional and concise — write every user-facing message, button label, error, and empty state in this voice.

Tracks referral conversions and automates XRocket payouts for merchants, with admin controls for payout management and referral tracking.

> This is the complete contract for the bot. Implement EVERY entry point, flow, feature, integration, and edge case below. The completeness review checks the bot against this document after each build pass.

## Primary audience

- admin/merchant
- referred users

## Success criteria

- Automatic XRocket payout triggered on successful referral conversion
- Admin receives real-time payout success/failure notifications
- Admin can manually retry failed payouts via Telegram

## Entry points

Every feature must be reachable from the bot's command/button surface (button-first; only /start and /help are slash commands).

- **/start** (command, actor: user, command: /start) — Open main admin menu or welcome message
- **/generate_referral** (command, actor: admin, command: /generate_referral) — Generate new referral link/code and store mapping
- **View Recent Referrals** (button, actor: admin, callback: admin:view_referrals) — Display latest referral records with status
- **Retry Failed Payout** (button, actor: admin, callback: payout:retry) — Retry specific failed payout transaction
- **Conversion Webhook** (button, actor: merchant_system) — Receive conversion events via POST for automatic tracking

## Flows

### Referral Creation
_Trigger:_ /generate_referral

1. Admin requests referral generation
2. Bot creates unique link/code
3. Stores referral with admin ID

_Data touched:_ Referral

### Conversion Handling
_Trigger:_ Webhook POST or /record_conversion

1. Receive conversion event
2. Validate referral mapping
3. Mark conversion as successful
4. Trigger payout workflow

_Data touched:_ Conversion, Payout

### Payout Execution
_Trigger:_ Successful conversion

1. Calculate payout amount
2. Call XRocket API
3. Store payout record
4. Notify admin with result

_Data touched:_ Payout, Admin Profile

## Data entities

Durable data (must survive a restart) uses the toolkit's persistent store, never in-memory maps.

- **Referral** _(retention: persistent)_ — Referral link/code tracking
  - fields: referrer_id, referred_user_id, campaign, status, timestamp
- **Conversion** _(retention: persistent)_ — Tracked conversion events
  - fields: referral_id, order_id, amount, timestamp, success_flag
- **Admin Profile** _(retention: persistent)_ — Merchant account settings
  - fields: telegram_id, xrocket_account, payout_amount
- **Payout** _(retention: persistent)_ — Payment records
  - fields: payout_id, referral_id, amount, status, tx_reference, timestamp

## Integrations

- **Telegram** (required) — Admin interface and notifications
- **XRocket API** (required) — Automated payout execution
- **Webhook Endpoint** (optional) — Conversion event ingestion
Call external APIs against their real contract (correct endpoints, ids, params); credentials from env. Do not fake responses.

## Owner controls

- Configure XRocket account credentials
- Set payout amount rules
- Manually retry failed payouts
- View referral conversion history

## Notifications

- Payout success/failure alerts to admin
- Critical error notifications
- Referral link delivery to users

## Permissions & privacy

- Secure storage of XRocket credentials
- Telegram ID verification for admin actions
- Minimal data collection on referred users

## Edge cases

- Failed XRocket API call handling
- Missing webhook conversion events
- Invalid referral code usage
- Multiple conversions per referral

## Required tests

- End-to-end payout workflow with webhook trigger
- Manual payout retry flow
- Admin notification reliability test

## Assumptions

- Single admin account model
- Merchant can provide conversion events via webhook or manual input
- No automatic retry for failed payouts
