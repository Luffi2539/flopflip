import React from 'react';
import { AdapterContext } from '@flopflip/react';
import { TAdapterContext } from '@flopflip/types';

export default function useAdapterReconfiguration() {
  const adapterContext: TAdapterContext = React.useContext(AdapterContext);

  return adapterContext.reconfigure;
}
