import React from 'react';
import { useNavigate } from 'react-router-dom';
import { Button } from '../components/ui/Button';

export const NotFound: React.FC = () => {
  const navigate = useNavigate();

  return (
    <div className="min-h-[60vh] flex flex-col items-center justify-center text-center p-6">
      <div className="w-20 h-20 bg-indigo-50 dark:bg-indigo-950/20 text-indigo-600 dark:text-indigo-400 rounded-full flex items-center justify-center text-3xl font-extrabold mb-6">
        404
      </div>
      <h2 className="text-xl font-bold text-text-primary dark:text-white">
        Halaman Tidak Ditemukan
      </h2>
      <p className="text-sm text-text-secondary max-w-sm mt-2 mb-6">
        Maaf, halaman yang Anda cari tidak tersedia atau sedang dalam pengembangan.
      </p>
      <Button variant="primary" onClick={() => navigate('/')}>
        Kembali ke Dashboard
      </Button>
    </div>
  );
};
