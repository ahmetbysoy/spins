import React from 'react';
import { Toaster, toast } from 'sonner';

export const ToastProvider = () => <Toaster theme="dark" position="top-right" />;

export const showToast = (message: string, type: 'success' | 'error' = 'success') => {
  if (type === 'success') {
    toast.success(message);
  } else {
    toast.error(message);
  }
};
