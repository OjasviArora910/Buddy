# Security model and release boundary

Firebase authenticates identities; PostgreSQL stores application data. Every account endpoint must validate an ID token, map its UID server-side, and scope reads/writes by internal user ID. Keep Firebase Admin credentials, database passwords, and Gemini keys on the backend. Avoid logging message bodies, tokens, or secrets. Restrict CORS, validate request sizes, rate-limit chat, use transactions for paired message writes, and verify ownership before mutations.

Quick Chat is anonymous and must not persist messages. It still sends text to Gemini for inference. Current crisis detection is a keyword fallback and is not clinically validated. Verify emergency resources before release. Internal engineering use only.
