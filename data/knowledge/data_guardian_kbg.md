# DATA-GUARDIAN-2.0 / Secure Protocol 1.0 Knowledge Base

## Architectural Ontology & Entities

DATA-GUARDIAN-2.0 is an enterprise secure file sharing and collaborative editing protocol.

### Roles & Governance Hierarchy
- **Platform Admin (`actor.admin`)**: Rank 0 global administrator allowlisted via `ADMIN_EMAILS` env var. Oversees tenant accounts (`src/lib/security/roles.ts`).
- **Company Tenant (`actor.company`)**: Enterprise boundary defined in `prisma/schema.prisma:Organization`. Manages KMS configurations and member seats.
- **Manager (`actor.manager`)**: Rank 1 member supervising team leaders via `managerUserId`.
- **Owner / Team Leader (`actor.owner`)**: Rank 1 role with self-serve capability to create `SecureLink` records and hold the `ownerToken` for instant kill-switch revocation.
- **Vendor (`actor.vendor`)**: Rank 2 external guest authenticated via OTP email, accessing files at `/share/[token]` -> `/view/[token]`.

### Cryptographic Engine
- **Master KEK (`crypto.master_kek`)**: 256-bit AES hex key loaded from `KEK_KEY`. Wraps per-file DEKs (`src/lib/crypto.ts:getKekKey`).
- **Ephemeral DEK (`crypto.dek`)**: 32-byte key generated uniquely per uploaded file using `crypto.randomBytes(32)` (`src/lib/crypto.ts:generateDek`). Never stored in plaintext (INV-002).
- **AES-256-GCM Engine (`crypto.aes256gcm`)**: Galois/Counter Mode symmetric cipher providing confidentiality, 16-byte random IV, and 16-byte authentication tag for tamper detection (`src/lib/crypto.ts:encryptBuffer`).
- **OTP HMAC-SHA256 (`crypto.otp_hmac`)**: Timing-safe validator for 6-digit passcodes using `OTP_HMAC_SECRET` (`src/lib/crypto.ts:hashOTPSync`).
- **Session HMAC-SHA256 (`crypto.session_hmac`)**: Signs session tokens and cookies using `SESSION_HMAC_SECRET` (`src/lib/share-session.ts`).
- **Audit Chain HMAC (`crypto.audit_hmac`)**: Chained HMAC log generator binding `entryHash` to `prevHash` via `AUDIT_HMAC_SECRET` (`src/lib/security/audit-chain.ts`).
- **Device Fingerprint (`crypto.device_fingerprint`)**: SHA-256 hash of IP + User-Agent + Accept-Language bound to vendor session on verify (`src/lib/fingerprint.ts`).
- **Forensic Watermark (`crypto.forensic_watermark`)**: 12-row tiled canvas overlay projecting viewer email, token fragment, device signature, and timestamp (`src/lib/security/forensic-watermark.ts`).
- **External KMS Adapter (`crypto.kms_http`)**: HTTP proxy for tenant-managed keys with envelope prefix `kms:http:` (`src/lib/security/kms.ts`).

### Storage & Persistence Layer
- **PostgreSQL Database (`storage.postgres`)**: Relational database (Prisma ORM) housing accounts, SecureLink metadata, UserFile crypto columns (IV, authTag, encryptedDek), FileVersion history, SendRecord tombstones, and AuditLogs.
- **MongoDB GridFS (`storage.mongo_gridfs`)**: Ciphertext binary chunk store (`fs.files`, `fs.chunks`). Plaintext files are strictly prohibited (INV-001).
- **Upstash Redis (`storage.upstash_redis`)**: In-memory REST datastore managing active sessions (`session:{token}:{sessionId}`), revocation markers (`revoked:{token}`), and distributed edit locks (`document:editing-lock:{docId}`).
- **SendRecord (`entity.send_record`)**: Permanent compliance tombstone surviving link and file deletion for regulatory compliance (INV-008).

### Concurrency & Collaboration
- **Distributed Edit Lock (`collab.editing_lock`)**: Redis mutex key with 15s client heartbeat and 30s TTL (`src/lib/collaboration/edit-lock-service.ts`).
- **Hierarchical Priority Takeover (`collab.priority_takeover`)**: Owner (Priority 1) can preempt Vendor (Priority 2) with a 15-second grace period for auto-saving, generating a `PRIORITY_TAKEOVER` FileVersion (INV-010).
- **Editors**: Tiptap rich text Word editor (docx export) and ExcelJS workbook adapter.

### Verified Architectural Security Invariants

#### INV-001: Plaintext Storage Prohibition [ENFORCED - CRITICAL]
- **Statement**: "Plaintext sensitive files must never be persisted directly to MongoDB GridFS or PostgreSQL."
- **Enforcement**: `src/lib/create-link-stage.ts:stagePlainFile`
- **Verification**: Automated tests inspect putStagedCiphertext inputs to guarantee all stored chunks are encrypted bytes.

#### INV-002: DEK Envelope Protection [ENFORCED - CRITICAL]
- **Statement**: "Data Encryption Keys (DEK) must never be stored in plaintext; all stored DEKs must be wrapped with Master KEK or KMS."
- **Enforcement**: `src/lib/crypto.ts:encryptDek & src/lib/security/kms.ts:wrapDek`
- **Verification**: Database inspection confirms UserFile.encryptedDek is in format iv:authTag:ciphertext or kms:http:<b64>.

#### INV-003: OTP Rate Limiting & Lockout [ENFORCED - CRITICAL]
- **Statement**: "OTP verification is limited to 10 attempts per 15 minutes per IP; 3 failed link attempts permanently locks the link."
- **Enforcement**: `src/lib/rate-limit.ts:checkOTPRateLimit & src/actions/verify-otp.ts`
- **Verification**: Simulated brute-force tests verify 4th attempt returns LOCKED and marks SecureLink.lockedAt.

#### INV-004: Immediate Revocation Propagation [ENFORCED - CRITICAL]
- **Statement**: "Revoking a SecureLink must immediately invalidate all active sessions in Redis and reject sub-second read/write requests."
- **Enforcement**: `src/lib/redis.ts:invalidateSession & src/app/api/verify-access/route.ts`
- **Verification**: Redis exists revoked:{token} check occurs before database query on protected SSE/file streams.

#### INV-005: Active Device Fingerprint Binding [ENFORCED - HIGH]
- **Statement**: "Active vendor viewing sessions must remain bound to the client device fingerprint established during OTP unlock."
- **Enforcement**: `src/lib/session-device.ts:isSessionDeviceMismatch & src/actions/verify-otp.ts`
- **Verification**: Requests with modified User-Agent or IP headers return 401 session_invalid.

#### INV-006: Tamper-Evident Audit Hash Chaining [ENFORCED - CRITICAL]
- **Statement**: "AuditLog records must maintain an HMAC-SHA256 hash chain where entryHash binds to the previous record prevHash."
- **Enforcement**: `src/lib/security/audit-chain.ts:hashAuditEntry & verifyAuditEntry`
- **Verification**: Chain validation utility traverses log records verifying cryptographic continuity using AUDIT_HMAC_SECRET.

#### INV-007: Zero-Knowledge Server Limitation [NOT ENFORCED - MEDIUM]
- **Statement**: "The system does NOT provide end-to-end zero-knowledge isolation; the server unwraps DEKs in memory to serve views and edits."
- **Enforcement**: `src/lib/security/kms.ts:line 7 & src/lib/decrypt-user-file.ts`
- **Verification**: Code inspection confirms decryptUserFileBytes decrypts buffers into Node.js memory.

#### INV-008: Compliance Record Survival After Deletion [ENFORCED - HIGH]
- **Statement**: "Permanent deletion of expired links and files must preserve SendRecords and stamped AuditLogs for the link owner."
- **Enforcement**: `src/lib/cleanup-core.ts:stampSurvivingRecords & stampSendRecord`
- **Verification**: Integration test executes cleanup and verifies SendRecord exists while SecureLink and GridFS blobs are gone.

#### INV-009: Dual File Validation (Extension & Magic Bytes) [ENFORCED - HIGH]
- **Statement**: "Uploaded files must pass extension allowlist validation AND binary magic number sniffing before processing."
- **Enforcement**: `src/lib/security/file-validator.ts:validateMimeType & assertSafeUploadName`
- **Verification**: Unit tests upload file named doc.pdf containing PE executable bytes, confirming rejection.

#### INV-010: Hierarchical Concurrency Preemption [ENFORCED - MEDIUM]
- **Statement**: "Higher-priority collaborators (Owner level 1) can preempt lower-priority locks (Vendor level 2) with grace periods."
- **Enforcement**: `src/lib/collaboration/edit-lock-decision.ts & priority.ts`
- **Verification**: Concurrent session test verifies Owner lock request starts takeover timer on Vendor active lock.

### Ground-Truth Semantic Triple Store (Summary)

- `actor.admin` --**MANAGES**--> `actor.company`: Platform Admin configures organizations and seat limits *(Source: `src/lib/security/roles.ts`)*
- `actor.company` --**CONTAINS**--> `actor.manager`: Company organization contains manager members *(Source: `prisma/schema.prisma:OrganizationMember`)*
- `actor.manager` --**SUPERVISES**--> `actor.owner`: Manager supervises team leaders via managerUserId *(Source: `prisma/schema.prisma:OrganizationMember`)*
- `actor.owner` --**CREATES**--> `entity.secure_link`: Owner creates SecureLinks with files and access policies *(Source: `src/app/create-link/`)*
- `actor.owner` --**HOLDS**--> `entity.secure_link`: Owner holds private ownerToken for instantaneous link revocation *(Source: `prisma/schema.prisma:SecureLink.ownerToken`)*
- `entity.secure_link` --**GRANTS_ACCESS_TO**--> `actor.vendor`: SecureLink grants restricted access to authenticated vendor *(Source: `src/lib/linkAuthorization.ts`)*
- `actor.vendor` --**AUTHENTICATES_VIA**--> `session.otp_verification`: Vendor authenticates using 6-digit one-time code *(Source: `src/actions/verify-otp.ts`)*
- `actor.vendor` --**BOUND_TO**--> `crypto.device_fingerprint`: Active session is permanently bound to vendor device signature *(Source: `src/lib/session-device.ts`)*
- `actor.owner` --**HAS_PRIORITY**--> `collab.priority_takeover`: Owner has priority rank 1, higher than vendor rank 2 *(Source: `src/lib/collaboration/priority.ts`)*
- `actor.vendor` --**HAS_STATUS**--> `session.vendor_access`: Vendor access tracks active, break, completed, and expired states *(Source: `prisma/schema.prisma:VendorStatus`)*
- `crypto.kms_http` --**WRAPS**--> `crypto.dek`: External KMS can wrap DEK with prefix kms:http: *(Source: `src/lib/security/kms.ts:wrapDek`)*
- `crypto.dek` --**ENCRYPTS**--> `entity.user_file`: DEK encrypts file bytes using AES-256-GCM *(Source: `src/lib/create-link-stage.ts:stagePlainFile`)*
- `crypto.otp_hmac` --**VALIDATES**--> `session.otp_verification`: HMAC-SHA256 validates 6-digit OTP using timing-safe comparison *(Source: `src/lib/crypto.ts:verifyOTPHash`)*
- `crypto.session_hmac` --**SIGNS**--> `session.redis_session`: SESSION_HMAC_SECRET signs session_id cookie and token parameter *(Source: `src/lib/share-session.ts:signShareSession`)*
- `crypto.audit_hmac` --**CHAINS**--> `compliance.audit_log`: AUDIT_HMAC_SECRET hashes entry with prevHash to prevent tampering *(Source: `src/lib/security/audit-chain.ts:hashAuditEntry`)*
- `crypto.dek` --**UNWRAPPED_BY**--> `crypto.master_kek`: decryptUserFileBytes unwraps DEK using Master KEK to serve content *(Source: `src/lib/decrypt-user-file.ts:decryptUserFileBytes`)*
- `crypto.aes256gcm` --**DETECTS_TAMPERING_ON**--> `entity.user_file`: Mismatched authTag throws error on file decryption *(Source: `src/lib/crypto.ts:decryptBuffer`)*
- `crypto.dek` --**NEVER_STORED_AS**--> `storage.postgres`: DEK is never stored in plaintext in PostgreSQL database *(Source: `src/lib/create-link-stage.ts`)*
- `storage.postgres` --**STORES_METADATA_FOR**--> `entity.secure_link`: Postgres stores link token, expiry, failedAttempts, and rules *(Source: `prisma/schema.prisma:SecureLink`)*
- `storage.postgres` --**STORES_METADATA_FOR**--> `entity.user_file`: Postgres stores fileName, iv, authTag, encryptedDek, and mongoFileId *(Source: `prisma/schema.prisma:UserFile`)*
- `storage.mongo_gridfs` --**STORES_CIPHERTEXT_FOR**--> `entity.user_file`: GridFS stores encrypted binary chunks under gridfs:<oid> pointer *(Source: `src/lib/blob-store.ts:putCiphertext`)*
- `storage.upstash_redis` --**CACHES_ACTIVE_STATE_FOR**--> `session.redis_session`: Redis caches ephemeral session data with automatic TTL *(Source: `src/lib/redis.ts:createSession`)*
- `storage.upstash_redis` --**TRACKS_REVOCATION_FOR**--> `entity.secure_link`: Redis maintains revoked:{token} kill-switch marker for 24h *(Source: `src/lib/redis.ts:invalidateSession`)*
- `storage.postgres` --**RETAINS_TOMBSTONE**--> `entity.send_record`: Postgres preserves SendRecord even after link and file are deleted *(Source: `src/lib/send-record.ts:stampSendRecord`)*
- `storage.postgres` --**STORES_IMMUTABLE_LOGS**--> `compliance.audit_log`: AuditLog rows in Postgres survive cleanup via denormalized ownerId *(Source: `src/lib/cleanup-core.ts:stampSurvivingRecords`)*
- `storage.mongo_gridfs` --**CHUNKS_BLOBS_INTO**--> `storage.mongo_gridfs`: GridFS splits ciphertext into standard 255KB binary chunks in fs.chunks *(Source: `src/lib/mongo/operations.ts`)*
- `storage.postgres` --**STORES_VERSION_HISTORY**--> `entity.file_version`: FileVersion tracks edit history, change description, and storageKey *(Source: `prisma/schema.prisma:FileVersion`)*
- `storage.upstash_redis` --**STORES_LOCK_STATE**--> `collab.editing_lock`: document:editing-lock:{docId} stores active lock holder and heartbeat *(Source: `src/lib/collaboration/edit-lock-service.ts`)*
- `storage.postgres` --**CASCADES_DELETIONS_ON**--> `entity.user_file`: Deleting SecureLink cascades to associated UserFile rows in Postgres *(Source: `prisma/schema.prisma:UserFile_secureLinkId_fkey`)*
- `session.otp_verification` --**ENFORCES_RATE_LIMIT**--> `session.rate_limiter`: 10 failed attempts per 15 min per IP blocks request before DB query *(Source: `src/lib/rate-limit.ts:checkOTPRateLimit`)*
- `session.break_session` --**CLEARS_ACTIVE_SESSION**--> `session.redis_session`: Vendor break removes active session key from Upstash Redis *(Source: `src/lib/redis.ts:invalidateOneSession`)*
- `session.revocation` --**DROPS_REDIS_SET**--> `session.redis_session`: Revocation empties sessions:{token} set and deletes individual session keys *(Source: `src/lib/redis.ts:invalidateSession`)*
- `session.vendor_access` --**REJECTS_DEVICE_MISMATCH**--> `crypto.device_fingerprint`: Session request from a different device fingerprint is rejected with 401 *(Source: `src/lib/session-device.ts:isSessionDeviceMismatch`)*
- `collab.editing_lock` --**PREVENTS_RACES_ON**--> `entity.user_file`: Edit lock prevents two collaborators from clobbering file versions *(Source: `src/lib/collaboration/edit-lock-service.ts`)*
- `collab.priority_takeover` --**ALLOWS_GRACE_PERIOD**--> `collab.editing_lock`: Preempted vendor is given 15 seconds grace period to auto-save work *(Source: `src/lib/collaboration/edit-lock-types.ts:graceEndsAt`)*
- `collab.tiptap_editor` --**EXPORTS_DOCX_AND_HTML**--> `entity.file_version`: Tiptap editor bundles docx exporter creating valid Word documents *(Source: `src/components/editors/word/wordExporters.ts`)*
- `collab.excel_editor` --**PARSES_WORKBOOK_WITH**--> `collab.excel_editor`: ExcelJS processes XLSX worksheets into reactive grid models *(Source: `src/lib/workbookAdapter.ts`)*
- `pipeline.cleanup_cron` --**PURGES_EXPIRED_LINKS**--> `entity.secure_link`: executeCleanup purges links where expiresAt < now *(Source: `src/lib/cleanup-core.ts:executeCleanup`)*
- `pipeline.cleanup_cron` --**DELETES_GRIDFS_CHUNKS**--> `storage.mongo_gridfs`: deleteGridFSFiles invokes deleteLiveObjects to unmount GridFS binary *(Source: `src/lib/cleanup-core.ts:deleteGridFSFiles`)*
- `pipeline.file_validator` --**CHECKS_MAGIC_BYTES**--> `entity.user_file`: validateMimeType sniffs binary signatures (PDF: %PDF, DOCX: PK..) *(Source: `src/lib/security/file-validator.ts`)*
- `pipeline.file_validator` --**BLOCKS_DOUBLE_EXTENSIONS**--> `entity.user_file`: assertSafeUploadName blocks dangerous extensions such as file.pdf.exe *(Source: `src/lib/create-link-stage.ts:assertSafeUploadName`)*
- `pipeline.malware_scan` --**INSPECT_BUFFER**--> `pipeline.create_link_stage`: scanUploadBuffer scans byte buffer with signature database before staging *(Source: `src/lib/security/malware-scan.ts`)*
- `compliance.mongo_upload_log` --**STORES_CHECKSUM**--> `entity.user_file`: MongoUploadLog records SHA-256 checksum of raw upload file content *(Source: `prisma/schema.prisma:MongoUploadLog.checksum`)*
- `entity.secure_link` --**ENFORCES_MAX_DOWNLOADS**--> `entity.secure_link`: Exceeding maxDownloads blocks subsequent file download attempts *(Source: `src/app/api/files/[id]/route.ts`)*
