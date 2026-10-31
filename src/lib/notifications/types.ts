export interface NotificationChannelProvider {
  send(input: {
    recipient: string;
    body?: string;
    template?: string;
    contentVariables?: Record<string, string>;
  }): Promise<{
    success: boolean;
    httpStatus: number;
    messageSid?: string;
    errorCode?: string;
    error?: string;
    retryable: boolean;
  }>;
}
