/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 * @emails react-core
 * @jest-environment node
 */

'use strict';

let React;
let ReactNoop;
let Scheduler;
let act;
let waitForAll;
let assertLog;
let waitForPaint;
let assertConsoleErrorDev;
let useState;
let useEffect;
let useLayoutEffect;
let Suspense;
let startTransition;

describe('ReactFiberFeature', () => {
  beforeEach(() => {
    jest.resetModules();

    const ReactFeatureFlags = require('shared/ReactFeatureFlags');
    ReactFeatureFlags.enableFeature = true;

    React = require('react');
    ReactNoop = require('react-noop-renderer');
    Scheduler = require('scheduler');

    const InternalTestUtils = require('internal-test-utils');
    act = InternalTestUtils.act;
    waitForAll = InternalTestUtils.waitForAll;
    assertLog = InternalTestUtils.assertLog;
    waitForPaint = InternalTestUtils.waitForPaint;
    assertConsoleErrorDev = InternalTestUtils.assertConsoleErrorDev;

    useState = React.useState;
    useEffect = React.useEffect;
    useLayoutEffect = React.useLayoutEffect;
    Suspense = React.Suspense;
    startTransition = React.startTransition;
  });

  function Text(props) {
    Scheduler.log(props.text);
    return <span prop={props.text}>{props.children}</span>;
  }

  // ---------------------------------------------------------------------------
  // useFeature hook tests
  // ---------------------------------------------------------------------------

  // @gate enableFeature
  it('useFeature returns the passthrough value on initial mount', async () => {
    function App() {
      const [state] = React.useFeature('initial');
      Scheduler.log('State: ' + state);
      return <Text text={state} />;
    }

    const root = ReactNoop.createRoot();
    await act(async () => {
      root.render(<App />);
    });
    assertLog(['State: initial', 'initial']);
    expect(root).toMatchRenderedOutput(<span prop="initial" />);
  });

  // @gate enableFeature
  it('useFeature re-renders when passthrough value changes', async () => {
    function App({text}) {
      const [state] = React.useFeature(text);
      Scheduler.log('State: ' + state);
      return <Text text={state} />;
    }

    const root = ReactNoop.createRoot();
    await act(async () => {
      root.render(<App text="A" />);
    });
    assertLog(['State: A', 'A']);
    expect(root).toMatchRenderedOutput(<span prop="A" />);

    // Update the passthrough value
    await act(async () => {
      root.render(<App text="B" />);
    });
    assertLog(['State: B', 'B']);
    expect(root).toMatchRenderedOutput(<span prop="B" />);
  });

  // @gate enableFeature
  it('useFeature returns a dispatch function', async () => {
    let dispatch;
    function App() {
      const [state, _dispatch] = React.useFeature('hello');
      dispatch = _dispatch;
      Scheduler.log('State: ' + state);
      return <Text text={state} />;
    }

    const root = ReactNoop.createRoot();
    await act(async () => {
      root.render(<App />);
    });
    assertLog(['State: hello', 'hello']);
    expect(typeof dispatch).toBe('function');
  });

  // @gate enableFeature
  it('useFeature works alongside useState', async () => {
    let setCount;
    function App() {
      const [count, _setCount] = useState(0);
      setCount = _setCount;
      const [featureState] = React.useFeature(count);
      Scheduler.log('Feature: ' + featureState + ', Count: ' + count);
      return <Text text={'Feature: ' + featureState} />;
    }

    const root = ReactNoop.createRoot();
    await act(async () => {
      root.render(<App />);
    });
    assertLog(['Feature: 0, Count: 0', 'Feature: 0']);
    expect(root).toMatchRenderedOutput(<span prop="Feature: 0" />);

    // Update state via useState — passthrough updates accordingly
    await act(async () => {
      setCount(1);
    });
    assertLog(['Feature: 1, Count: 1', 'Feature: 1']);
    expect(root).toMatchRenderedOutput(<span prop="Feature: 1" />);
  });

  // @gate enableFeature
  it('useFeature works with useEffect for cleanup on unmount', async () => {
    function App() {
      const [state] = React.useFeature('mounted');
      useEffect(() => {
        Scheduler.log('Effect mount');
        return () => {
          Scheduler.log('Effect cleanup');
        };
      }, []);
      return <Text text={state} />;
    }

    const root = ReactNoop.createRoot();
    await act(async () => {
      root.render(<App />);
    });
    assertLog(['mounted', 'Effect mount']);
    expect(root).toMatchRenderedOutput(<span prop="mounted" />);

    // Unmount
    await act(async () => {
      root.render(null);
    });
    assertLog(['Effect cleanup']);
    expect(root).toMatchRenderedOutput(null);
  });

  // @gate enableFeature
  it('useFeature works with useLayoutEffect', async () => {
    function App() {
      const [state] = React.useFeature('layout');
      useLayoutEffect(() => {
        Scheduler.log('Layout effect: ' + state);
        return () => {
          Scheduler.log('Layout cleanup: ' + state);
        };
      });
      return <Text text={state} />;
    }

    const root = ReactNoop.createRoot();
    await act(async () => {
      root.render(<App />);
    });
    assertLog(['layout', 'Layout effect: layout']);
    expect(root).toMatchRenderedOutput(<span prop="layout" />);
  });

  // @gate enableFeature
  it('useFeature with null passthrough value', async () => {
    function App() {
      const [state] = React.useFeature(null);
      Scheduler.log('State: ' + String(state));
      return <Text text={String(state)} />;
    }

    const root = ReactNoop.createRoot();
    await act(async () => {
      root.render(<App />);
    });
    assertLog(['State: null', 'null']);
    expect(root).toMatchRenderedOutput(<span prop="null" />);
  });

  // @gate enableFeature
  it('useFeature with object passthrough value', async () => {
    const obj = {key: 'value'};
    function App({data}) {
      const [state] = React.useFeature(data);
      Scheduler.log('State key: ' + state.key);
      return <Text text={state.key} />;
    }

    const root = ReactNoop.createRoot();
    await act(async () => {
      root.render(<App data={obj} />);
    });
    assertLog(['State key: value', 'value']);
    expect(root).toMatchRenderedOutput(<span prop="value" />);

    // Update with new object
    await act(async () => {
      root.render(<App data={{key: 'updated'}} />);
    });
    assertLog(['State key: updated', 'updated']);
    expect(root).toMatchRenderedOutput(<span prop="updated" />);
  });

  // @gate enableFeature
  it('useFeature handles multiple instances in the same component', async () => {
    function App({a, b}) {
      const [stateA] = React.useFeature(a);
      const [stateB] = React.useFeature(b);
      Scheduler.log('A: ' + stateA + ', B: ' + stateB);
      return <Text text={stateA + '-' + stateB} />;
    }

    const root = ReactNoop.createRoot();
    await act(async () => {
      root.render(<App a="x" b="y" />);
    });
    assertLog(['A: x, B: y', 'x-y']);
    expect(root).toMatchRenderedOutput(<span prop="x-y" />);

    // Update both
    await act(async () => {
      root.render(<App a="m" b="n" />);
    });
    assertLog(['A: m, B: n', 'm-n']);
    expect(root).toMatchRenderedOutput(<span prop="m-n" />);
  });

  // @gate enableFeature
  it('useFeature preserves dispatch identity across re-renders', async () => {
    const dispatches = [];
    function App({text}) {
      const [state, dispatch] = React.useFeature(text);
      dispatches.push(dispatch);
      Scheduler.log('State: ' + state);
      return <Text text={state} />;
    }

    const root = ReactNoop.createRoot();
    await act(async () => {
      root.render(<App text="A" />);
    });
    assertLog(['State: A', 'A']);

    await act(async () => {
      root.render(<App text="B" />);
    });
    assertLog(['State: B', 'B']);

    // Dispatch function should be stable across re-renders
    expect(dispatches.length).toBe(2);
    expect(dispatches[0]).toBe(dispatches[1]);
  });

  // ---------------------------------------------------------------------------
  // Error handling tests
  // ---------------------------------------------------------------------------

  // @gate enableFeature
  it('throws when useFeature is called outside a component render', async () => {
    expect(() => {
      React.useFeature('test');
    }).toThrow();
    assertConsoleErrorDev([
      'Invalid hook call. Hooks can only be called inside of the body of a function component. ' +
        'This could happen for one of the following reasons:\n' +
        '1. You might have mismatching versions of React and the renderer (such as React DOM)\n' +
        '2. You might be breaking the Rules of Hooks\n' +
        '3. You might have more than one copy of React in the same app\n' +
        'See https://react.dev/link/invalid-hook-call for tips about how to debug and fix this problem.',
    ]);
  });

  // @gate enableFeature
  it('useFeature can be used in nested components', async () => {
    function Parent({value}) {
      const [parentState] = React.useFeature(value);
      return (
        <>
          <Text text={'Parent: ' + parentState} />
          <Child value={parentState} />
        </>
      );
    }

    function Child({value}) {
      const [childState] = React.useFeature(value);
      return <Text text={'Child: ' + childState} />;
    }

    const root = ReactNoop.createRoot();
    await act(async () => {
      root.render(<Parent value="hello" />);
    });
    assertLog(['Parent: hello', 'Child: hello']);
    expect(root).toMatchRenderedOutput(
      <>
        <span prop="Parent: hello" />
        <span prop="Child: hello" />
      </>,
    );

    // Update
    await act(async () => {
      root.render(<Parent value="world" />);
    });
    assertLog(['Parent: world', 'Child: world']);
    expect(root).toMatchRenderedOutput(
      <>
        <span prop="Parent: world" />
        <span prop="Child: world" />
      </>,
    );
  });

  // @gate enableFeature
  it('useFeature with numeric passthrough', async () => {
    function Counter({count}) {
      const [state] = React.useFeature(count);
      Scheduler.log('Count: ' + state);
      return <Text text={'Count: ' + state} />;
    }

    const root = ReactNoop.createRoot();
    await act(async () => {
      root.render(<Counter count={0} />);
    });
    assertLog(['Count: 0', 'Count: 0']);
    expect(root).toMatchRenderedOutput(<span prop="Count: 0" />);

    await act(async () => {
      root.render(<Counter count={42} />);
    });
    assertLog(['Count: 42', 'Count: 42']);
    expect(root).toMatchRenderedOutput(<span prop="Count: 42" />);
  });

  // @gate enableFeature
  it('useFeature with boolean passthrough', async () => {
    function Toggle({enabled}) {
      const [state] = React.useFeature(enabled);
      Scheduler.log('Enabled: ' + state);
      return <Text text={'Enabled: ' + state} />;
    }

    const root = ReactNoop.createRoot();
    await act(async () => {
      root.render(<Toggle enabled={false} />);
    });
    assertLog(['Enabled: false', 'Enabled: false']);
    expect(root).toMatchRenderedOutput(<span prop="Enabled: false" />);

    await act(async () => {
      root.render(<Toggle enabled={true} />);
    });
    assertLog(['Enabled: true', 'Enabled: true']);
    expect(root).toMatchRenderedOutput(<span prop="Enabled: true" />);
  });

  // ---------------------------------------------------------------------------
  // Transition and Suspense integration tests
  // ---------------------------------------------------------------------------

  // @gate enableFeature
  it('useFeature works within a startTransition callback', async () => {
    let setCount;
    function App() {
      const [count, _setCount] = React.useState(0);
      setCount = _setCount;
      const [featureState] = React.useFeature(count);
      Scheduler.log('Count: ' + featureState);
      return <Text text={'Count: ' + featureState} />;
    }

    const root = ReactNoop.createRoot();
    await act(async () => {
      root.render(<App />);
    });
    assertLog(['Count: 0', 'Count: 0']);
    expect(root).toMatchRenderedOutput(<span prop="Count: 0" />);

    // Wrap the state update in startTransition
    await act(async () => {
      startTransition(() => {
        setCount(1);
      });
    });
    assertLog(['Count: 1', 'Count: 1']);
    expect(root).toMatchRenderedOutput(<span prop="Count: 1" />);
  });

  // @gate enableFeature
  it('useFeature renders inside a Suspense boundary', async () => {
    function SuspendedChild({value}) {
      const [state] = React.useFeature(value);
      Scheduler.log('Suspended child: ' + state);
      return <Text text={'Value: ' + state} />;
    }

    function App({value}) {
      return (
        <Suspense fallback={<Text text="Loading..." />}>
          <SuspendedChild value={value} />
        </Suspense>
      );
    }

    const root = ReactNoop.createRoot();
    await act(async () => {
      root.render(<App value="loaded" />);
    });
    assertLog(['Suspended child: loaded', 'Value: loaded']);
    expect(root).toMatchRenderedOutput(<span prop="Value: loaded" />);
  });

  // @gate enableFeature
  it('useFeature updates flush correctly with waitForAll', async () => {
    function Counter({count}) {
      const [state] = React.useFeature(count);
      Scheduler.log('Render: ' + state);
      return <Text text={String(state)} />;
    }

    const root = ReactNoop.createRoot();
    React.startTransition(() => {
      root.render(<Counter count={1} />);
    });
    await waitForAll(['Render: 1', '1']);
    expect(root).toMatchRenderedOutput(<span prop="1" />);
  });

  // @gate enableFeature
  it('useFeature updates are visible after waitForPaint', async () => {
    let setVal;
    function App() {
      const [val, _setVal] = React.useState('initial');
      setVal = _setVal;
      const [featureVal] = React.useFeature(val);
      Scheduler.log('Paint: ' + featureVal);
      return <Text text={featureVal} />;
    }

    const root = ReactNoop.createRoot();
    await act(async () => {
      root.render(<App />);
    });
    assertLog(['Paint: initial', 'initial']);

    React.startTransition(() => {
      setVal('updated');
    });
    await waitForPaint(['Paint: updated', 'updated']);
    expect(root).toMatchRenderedOutput(<span prop="updated" />);
  });
});
