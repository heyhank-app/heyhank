declare module "web-push" {
  interface VapidKeys {
    publicKey: string;
    privateKey: string;
  }

  interface PushSubscription {
    endpoint: string;
    keys: {
      p256dh: string;
      auth: string;
    };
  }

  interface SendOptions {
    TTL?: number;
    headers?: Record<string, string>;
    vapidDetails?: {
      subject: string;
      publicKey: string;
      privateKey: string;
    };
  }

  interface SendResult {
    statusCode: number;
    body: string;
    headers: Record<string, string>;
  }

  function generateVAPIDKeys(): VapidKeys;
  function setVapidDetails(
    subject: string,
    publicKey: string,
    privateKey: string,
  ): void;
  function sendNotification(
    subscription: PushSubscription,
    payload: string | Buffer | null,
    options?: SendOptions,
  ): Promise<SendResult>;

  const webpush: {
    generateVAPIDKeys: typeof generateVAPIDKeys;
    setVapidDetails: typeof setVapidDetails;
    sendNotification: typeof sendNotification;
  };

  export default webpush;
  export { generateVAPIDKeys, setVapidDetails, sendNotification };
}
