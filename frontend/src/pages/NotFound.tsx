import React from 'react';
import { useNavigate } from 'react-router-dom';
import { Button } from '../components/ui/Button';

export const NotFound: React.FC = () => {
  const navigate = useNavigate();

  return (
    <div className="min-h-[65vh] flex flex-col items-center justify-center text-center p-6 animate-fade-in">
      <div className="w-20 h-20 bg-indigo-50 dark:bg-indigo-500/15 text-indigo-600 dark:text-indigo-400 rounded-3xl ring-1 ring-inset ring-indigo-600/15 flex items-center justify-center font-display text-3xl font-extrabold mb-6 shadow-sm">
        404
      </div>
      <h2 className="font-display text-xl font-bold text-slate-900 dark:text-white">
        Halaman Tidak Ditemukan
      </h2>
      <p className="text-sm text-slate-500 dark:text-slate-400 max-w-sm mt-2 mb-6 leading-relaxed">
        Maaf, halaman yang Anda tuju tidak tersedia atau tautan telah berpindah.
      </p>
      <Button variant="primary" onClick={() => navigate('/')}>
        Kembali ke Dashboard
      </Button>
    </div>
  );
};

export default NotFound;
