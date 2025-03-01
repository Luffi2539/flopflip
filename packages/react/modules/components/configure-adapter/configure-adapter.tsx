import {
  TFlags,
  TAdapter,
  TAdapterInterface,
  TAdapterArgs,
  TAdapterStatus,
  TAdapterReconfiguration,
  TAdapterConfigurationStatus,
  TAdapterInitializationStatus,
  TAdapterReconfigurationOptions,
  TConfigureAdapterChildren,
  TAdapterStatusChange,
  TFlagsChange,
} from '@flopflip/types';
import React from 'react';
import {
  isFunctionChildren,
  isEmptyChildren,
  mergeAdapterArgs,
} from './helpers';
import AdapterContext, { createAdapterContext } from '../adapter-context';

type ValueOf<T> = T[keyof T];

export const AdapterStates = {
  UNCONFIGURED: 'unconfigured',
  CONFIGURING: 'configuring',
  CONFIGURED: 'configured',
} as const;
export type TAdapterStates = ValueOf<typeof AdapterStates>;

type TProps = {
  shouldDeferAdapterConfiguration?: boolean;
  adapter: TAdapter;
  adapterArgs: TAdapterArgs;
  adapterStatus?: TAdapterStatus;
  defaultFlags?: TFlags;
  onFlagsStateChange: (flags: TFlagsChange) => void;
  onStatusStateChange: (status: TAdapterStatusChange) => void;
  render?: () => React.ReactNode;
  children?: TConfigureAdapterChildren;
};

const useAppliedAdapterArgsState = ({
  initialAdapterArgs,
}: {
  initialAdapterArgs: TAdapterArgs;
}): [TAdapterArgs, (nextAdapterArgs: TAdapterArgs) => void] => {
  const [appliedAdapterArgs, setAppliedAdapterArgs] = React.useState<
    TAdapterArgs
  >(initialAdapterArgs);

  const applyAdapterArgs = React.useCallback(
    (nextAdapterArgs: TAdapterArgs) => {
      /**
       * NOTE:
       *   We can only unset `pendingAdapterArgs` after we actually perform
       *   a batched `setState` otherwise outdated `adapterArgs` as we loose
       *   the `pendingAdapterArgs` as we unset them too early.
       */
      setAppliedAdapterArgs(nextAdapterArgs);
    },
    [setAppliedAdapterArgs]
  );

  return [appliedAdapterArgs, applyAdapterArgs];
};

const useAdapterStateRef = (): [
  React.MutableRefObject<TAdapterStates>,
  (nextAdapterState: TAdapterStates) => void,
  () => boolean,
  () => boolean
] => {
  const adapterStateRef = React.useRef<TAdapterStates>(
    AdapterStates.UNCONFIGURED
  );

  const setAdapterState = React.useCallback(
    (nextAdapterState: TAdapterStates) => {
      adapterStateRef.current = nextAdapterState;
    },
    [adapterStateRef]
  );

  const getIsAdapterConfigured = React.useCallback(
    () => adapterStateRef.current === AdapterStates.CONFIGURED,
    [adapterStateRef]
  );

  const getDoesAdapterNeedInitialConfiguration = React.useCallback(
    () =>
      adapterStateRef.current !== AdapterStates.CONFIGURED &&
      adapterStateRef.current !== AdapterStates.CONFIGURING,
    [adapterStateRef]
  );

  return [
    adapterStateRef,
    setAdapterState,
    getIsAdapterConfigured,
    getDoesAdapterNeedInitialConfiguration,
  ];
};

const usePendingAdapterArgsRef = (
  appliedAdapterArgs: TAdapterArgs
): [
  React.MutableRefObject<TAdapterArgs | null>,
  (nextReconfiguration: TAdapterReconfiguration) => void,
  () => TAdapterArgs
] => {
  const pendingAdapterArgsRef = React.useRef<TAdapterArgs | null>(null);

  const setPendingAdapterArgs = React.useCallback(
    (nextReconfiguration: TAdapterReconfiguration): void => {
      /**
       * NOTE:
       *    The next reconfiguration is merged into the previous
       *    one instead of maintaining a queue.
       *
       *    The first merge is merged with `appliedAdapter` args
       *    to contain the initial state (through property initializer).
       */
      pendingAdapterArgsRef.current = mergeAdapterArgs(
        pendingAdapterArgsRef.current ?? appliedAdapterArgs,
        nextReconfiguration
      );
    },
    [appliedAdapterArgs, pendingAdapterArgsRef]
  );

  const unsetPendingAdapterArgs = React.useCallback(() => {
    pendingAdapterArgsRef.current = null;
  }, [pendingAdapterArgsRef]);

  /**
   * NOTE:
   *    Whenever the adapter delays configuration pending adapterArgs will
   *    be kept on `pendingAdapterArgs`. These can either be populated
   *    from calls to `UNSAFE_componentWillReceiveProps` or through `ReconfigureFlopflip`.
   *    Both cases go through `reconfigureOrQueue`.
   *
   *    In any case, when the adapter should be configured it should either
   *    be passed pending or applied adapterArgs.
   *
   */
  const getAdapterArgsForConfiguration = React.useCallback(
    (): TAdapterArgs => pendingAdapterArgsRef.current ?? appliedAdapterArgs,
    [appliedAdapterArgs, pendingAdapterArgsRef]
  );

  /**
   * NOTE: Clears the pending adapter args when applied adapter args changed.
   */
  React.useEffect(unsetPendingAdapterArgs, [
    appliedAdapterArgs,
    unsetPendingAdapterArgs,
  ]);

  return [
    pendingAdapterArgsRef,
    setPendingAdapterArgs,
    getAdapterArgsForConfiguration,
  ];
};

const useHandleDefaultFlagsCallback = ({ onFlagsStateChange }) => {
  const handleDefaultFlags = React.useCallback(
    (defaultFlags: TFlags): void => {
      if (Object.keys(defaultFlags).length > 0) {
        onFlagsStateChange(defaultFlags);
      }
    },
    [onFlagsStateChange]
  );

  return handleDefaultFlags;
};

const useConfigurationEffect = ({
  adapter,
  shouldDeferAdapterConfiguration,
  getDoesAdapterNeedInitialConfiguration,
  setAdapterState,
  onFlagsStateChange,
  onStatusStateChange,
  applyAdapterArgs,
  getAdapterArgsForConfiguration,
  getIsAdapterConfigured,
  pendingAdapterArgsRef,
  appliedAdapterArgs,
}) => {
  React.useEffect(() => {
    if (
      !shouldDeferAdapterConfiguration &&
      getDoesAdapterNeedInitialConfiguration()
    ) {
      setAdapterState(AdapterStates.CONFIGURING);

      (adapter as TAdapterInterface<TAdapterArgs>)
        .configure(getAdapterArgsForConfiguration(), {
          onFlagsStateChange,
          onStatusStateChange,
        })
        .then(configuration => {
          /**
           * NOTE:
           *    The configuration can be `undefined` then assuming `initializationStatus` to have
           *    succeeded to work with old adapters.
           */
          const isAdapterWithoutInitializationStatus = !configuration?.initializationStatus;

          if (
            isAdapterWithoutInitializationStatus ||
            configuration.initializationStatus ===
              TAdapterInitializationStatus.Succeeded
          ) {
            setAdapterState(AdapterStates.CONFIGURED);

            if (pendingAdapterArgsRef.current) {
              applyAdapterArgs(pendingAdapterArgsRef.current);
            }
          }
        });
      return;
    }

    if (getIsAdapterConfigured()) {
      setAdapterState(AdapterStates.CONFIGURING);

      (adapter as TAdapterInterface<TAdapterArgs>)
        .reconfigure(getAdapterArgsForConfiguration(), {
          onFlagsStateChange,
          onStatusStateChange,
        })
        .then(reconfiguration => {
          /**
           * NOTE:
           *    The configuration can be `undefined` then assuming `initializationStatus` to have
           *    succeeded to work with old adapters.
           */
          const isAdapterWithoutInitializationStatus = !reconfiguration?.initializationStatus;

          if (
            isAdapterWithoutInitializationStatus ||
            reconfiguration.initializationStatus ===
              TAdapterInitializationStatus.Succeeded
          ) {
            setAdapterState(AdapterStates.CONFIGURED);
          }
        });
    }
  }, [
    adapter,
    shouldDeferAdapterConfiguration,
    onFlagsStateChange,
    onStatusStateChange,
    applyAdapterArgs,
    getAdapterArgsForConfiguration,
    getDoesAdapterNeedInitialConfiguration,
    getIsAdapterConfigured,
    setAdapterState,
    pendingAdapterArgsRef,
    appliedAdapterArgs,
  ]);
};

const useDefaultFlagsEffect = ({
  adapter,
  defaultFlags,
  onFlagsStateChange,
  onStatusStateChange,
  setAdapterState,
  pendingAdapterArgsRef,
  shouldDeferAdapterConfiguration,
  applyAdapterArgs,
  getAdapterArgsForConfiguration,
}) => {
  const handleDefaultFlags = useHandleDefaultFlagsCallback({
    onFlagsStateChange,
  });

  React.useEffect(() => {
    if (defaultFlags) handleDefaultFlags(defaultFlags);

    if (!shouldDeferAdapterConfiguration) {
      setAdapterState(AdapterStates.CONFIGURING);

      (adapter as TAdapterInterface<TAdapterArgs>)
        .configure(getAdapterArgsForConfiguration(), {
          onFlagsStateChange,
          onStatusStateChange,
        })
        .then(configuration => {
          /**
           * NOTE:
           *    The configuration can be `undefined` then assuming `initializationStatus` to have
           *    succeeded to work with old adapters.
           */
          const isAdapterWithoutInitializationStatus = !configuration?.initializationStatus;

          if (
            isAdapterWithoutInitializationStatus ||
            configuration.initializationStatus ===
              TAdapterInitializationStatus.Succeeded
          ) {
            setAdapterState(AdapterStates.CONFIGURED);

            if (pendingAdapterArgsRef.current) {
              applyAdapterArgs(pendingAdapterArgsRef.current);
            }
          }
        });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
};

const usePendingAdapterArgsEffect = ({
  adapterArgs,
  appliedAdapterArgs,
  applyAdapterArgs,
  getIsAdapterConfigured,
  setPendingAdapterArgs,
}) => {
  /**
   * NOTE:
   *   This is passed through the React context (it's a public API).
   *   Internally this component has a `ReconfigureAdapter` type;
   *   this function has two arguments for clarify.
   */
  const reconfigureOrQueue = React.useCallback(
    (
      nextAdapterArgs: TAdapterArgs,
      options: TAdapterReconfigurationOptions
    ): void => {
      if (getIsAdapterConfigured()) {
        applyAdapterArgs(
          mergeAdapterArgs(appliedAdapterArgs, {
            adapterArgs: nextAdapterArgs,
            options,
          })
        );
        return;
      }

      setPendingAdapterArgs({ adapterArgs: nextAdapterArgs, options });
    },
    [
      appliedAdapterArgs,
      applyAdapterArgs,
      getIsAdapterConfigured,
      setPendingAdapterArgs,
    ]
  );

  React.useEffect(() => {
    /**
     * NOTE:
     *   The component might receive `adapterArgs` from `ReconfigureFlopflip`
     *   before it managed to configure. If that occurs the next `adapterArgs`
     *   passed in will overwrite what `ReconfigureFlopflip` passed in before
     *   yielding a loss in configuration.
     *
     *   However, when the adapter is configured we want the component to
     *   act in a controlled manner so that overwriting will occur when the
     *   passed `adapterArgs` change.
     */
    reconfigureOrQueue(adapterArgs, {
      shouldOverwrite: getIsAdapterConfigured(),
    });
  }, [adapterArgs, getIsAdapterConfigured, reconfigureOrQueue]);

  return [reconfigureOrQueue];
};

const ConfigureAdapter = (props: TProps) => {
  const [appliedAdapterArgs, applyAdapterArgs] = useAppliedAdapterArgsState({
    initialAdapterArgs: props.adapterArgs,
  });
  const [
    pendingAdapterArgsRef,
    setPendingAdapterArgs,
    getAdapterArgsForConfiguration,
  ] = usePendingAdapterArgsRef(appliedAdapterArgs);
  const [
    ,
    setAdapterState,
    getIsAdapterConfigured,
    getDoesAdapterNeedInitialConfiguration,
  ] = useAdapterStateRef();
  useDefaultFlagsEffect({
    adapter: props.adapter,
    defaultFlags: props.defaultFlags,
    onFlagsStateChange: props.onFlagsStateChange,
    onStatusStateChange: props.onStatusStateChange,
    shouldDeferAdapterConfiguration: props.shouldDeferAdapterConfiguration,
    setAdapterState,
    pendingAdapterArgsRef,
    getAdapterArgsForConfiguration,
    applyAdapterArgs,
  });
  const [reconfigureOrQueue] = usePendingAdapterArgsEffect({
    adapterArgs: props.adapterArgs,
    appliedAdapterArgs,
    applyAdapterArgs,
    getIsAdapterConfigured,
    setPendingAdapterArgs,
  });
  useConfigurationEffect({
    adapter: props.adapter,
    shouldDeferAdapterConfiguration: props.shouldDeferAdapterConfiguration,
    onFlagsStateChange: props.onFlagsStateChange,
    onStatusStateChange: props.onStatusStateChange,
    setAdapterState,
    pendingAdapterArgsRef,
    getDoesAdapterNeedInitialConfiguration,
    getAdapterArgsForConfiguration,
    getIsAdapterConfigured,
    applyAdapterArgs,
    appliedAdapterArgs,
  });

  return (
    <AdapterContext.Provider
      value={createAdapterContext(reconfigureOrQueue, props.adapterStatus)}
    >
      {(() => {
        const isAdapterConfigured = props.adapter.getIsConfigurationStatus(
          TAdapterConfigurationStatus.Configured
        );

        if (isAdapterConfigured) {
          if (typeof props.render === 'function') return props.render();
        }

        if (isFunctionChildren(props.children))
          return props.children({
            // NOTE: Deprecated, please use `isAdapterConfigured`.
            isAdapterReady: isAdapterConfigured,
            isAdapterConfigured,
          });

        if (props.children && !isEmptyChildren(props.children))
          return React.Children.only<React.ReactNode>(props.children);

        return null;
      })()}
    </AdapterContext.Provider>
  );
};

ConfigureAdapter.defaultProps = {
  shouldDeferAdapterConfiguration: false,
  defaultFlags: {},
  children: null,
  render: null,
};
ConfigureAdapter.displayName = 'ConfigureAdapter';

export default ConfigureAdapter;
