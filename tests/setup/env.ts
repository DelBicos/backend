/**
 * Runs before each unit test file is loaded, so production modules
 * see fixed credentials and never pick up a developer .env.
 * dotenv does not override variables that are already set.
 */
process.env.NODE_ENV = "test";
process.env.ENVIRONMENT = "development";
process.env.STRIPE_SECRET_KEY = "sk_test_ci";
process.env.SECRET_KEY = "unit-test-secret";
process.env.EXPIRES_IN = "1h";
process.env.SENDGRID_API_KEY = "SG.unit-test";
process.env.SENDER_EMAIL_VERIFICADO = "unit-test@example.com";
process.env.S3_BUCKET_NAME = "unit-test-bucket";
process.env.AWS_REGION = "us-east-1";

delete process.env.DATABASE_URL;
delete process.env.MONGODB_URI;
delete process.env.MONGODB_CHAT_URI;
delete process.env.LOGTAIL_TOKEN;
delete process.env.ENABLE_LOGTAIL;
delete process.env.ENABLE_CLOUDWATCH;
delete process.env.AWS_ACCESS_KEY_ID_CW;
delete process.env.LAMBDA_FUNCTION_URL;
delete process.env.LAMBDA_FUNCTION_NAME;
delete process.env.IMGBB_API_KEY;
