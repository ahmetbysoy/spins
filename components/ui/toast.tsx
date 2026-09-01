import React from 'react';
import { Toaster, toast } from 'sonner';

export const ToastProvider = () => <Toaster theme="dark" position="top-right" />;

export const showToast = (message: string, type: 'success' | 'error' | 'warning' | 'info' = 'success') => {
  switch (type) {
    case 'success':
      toast.success(message);
      break;
    case 'error':
      toast.error(message);
      break;
    case 'warning':
      toast.warning(message);
      break;
    default:
      toast.info(message);
  }
};
