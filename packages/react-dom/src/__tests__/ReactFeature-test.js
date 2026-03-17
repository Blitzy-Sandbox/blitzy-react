/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 * @emails react-core
 */

'use strict';

let React;
let ReactDOMClient;
let Scheduler;
let act;
let assertLog;
let Feature;
let useFeature;
let useState;
let useEffect;
let useLayoutEffect;
let Suspense;

describe('ReactDOMFeature', () => {
  let container;

  beforeEach(() => {
    jest.resetModules();
    React = require('react');
    ReactDOMClient = require('react-dom/client');
    Scheduler = require('scheduler');
    const InternalTestUtils = require('internal-test-utils');
    act = InternalTestUtils.act;
    assertLog = InternalTestUtils.assertLog;
    Feature = React.Feature;
    useFeature = React.useFeature;
    useState = React.useState;
    useEffect = React.useEffect;
    useLayoutEffect = React.useLayoutEffect;
    Suspense = React.Suspense;
    container = document.createElement('div');
    document.body.appendChild(container);
  });

  afterEach(() => {
    document.body.removeChild(container);
  });

  function Text(props) {
    Scheduler.log(props.text);
    return <span>{props.text}</span>;
  }

  // ---------------------------------------------------------------------------
  // Feature component type — basic rendering
  // ---------------------------------------------------------------------------

  // @gate enableFeature
  it('renders children inside a Feature component', async () => {
    function App() {
      return (
        <Feature>
          <div>Hello Feature</div>
        </Feature>
      );
    }

    const root = ReactDOMClient.createRoot(container);
    await act(() => root.render(<App />));
    expect(container.innerHTML).toContain('Hello Feature');
  });

  // @gate enableFeature
  it('renders children when mode is "active"', async () => {
    function App() {
      return (
        <Feature mode="active">
          <Text text="Active" />
        </Feature>
      );
    }

    const root = ReactDOMClient.createRoot(container);
    await act(() => root.render(<App />));
    assertLog(['Active']);
    expect(container.textContent).toBe('Active');
  });

  // @gate enableFeature
  it('renders children when mode is "inactive"', async () => {
    function App() {
      return (
        <Feature mode="inactive">
          <Text text="Inactive" />
        </Feature>
      );
    }

    const root = ReactDOMClient.createRoot(container);
    await act(() => root.render(<App />));
    assertLog(['Inactive']);
    // Children should still be in the DOM even when inactive
    expect(container.textContent).toContain('Inactive');
  });

  // @gate enableFeature
  it('toggles Feature mode via state update', async () => {
    let setMode;
    function App() {
      const [mode, _setMode] = useState('active');
      setMode = _setMode;
      return (
        <Feature mode={mode}>
          <Text text={'Mode: ' + mode} />
        </Feature>
      );
    }

    const root = ReactDOMClient.createRoot(container);
    await act(() => root.render(<App />));
    assertLog(['Mode: active']);
    expect(container.textContent).toBe('Mode: active');

    // Toggle to inactive
    await act(() => setMode('inactive'));
    assertLog(['Mode: inactive']);
    expect(container.textContent).toBe('Mode: inactive');

    // Toggle back to active
    await act(() => setMode('active'));
    assertLog(['Mode: active']);
    expect(container.textContent).toBe('Mode: active');
  });

  // @gate enableFeature
  it('Feature component defaults mode when not provided', async () => {
    function App() {
      return (
        <Feature>
          <Text text="Default mode" />
        </Feature>
      );
    }

    const root = ReactDOMClient.createRoot(container);
    await act(() => root.render(<App />));
    assertLog(['Default mode']);
    expect(container.textContent).toBe('Default mode');
  });

  // ---------------------------------------------------------------------------
  // useFeature hook — DOM integration
  // ---------------------------------------------------------------------------

  // @gate enableFeature
  it('useFeature returns the passthrough value in a DOM render', async () => {
    function App() {
      const [state] = useFeature('hello');
      return <div>{state}</div>;
    }

    const root = ReactDOMClient.createRoot(container);
    await act(() => root.render(<App />));
    expect(container.innerHTML).toBe('<div>hello</div>');
  });

  // @gate enableFeature
  it('useFeature updates when passthrough value changes', async () => {
    function App({text}) {
      const [state] = useFeature(text);
      return <div>{state}</div>;
    }

    const root = ReactDOMClient.createRoot(container);
    await act(() => root.render(<App text="first" />));
    expect(container.innerHTML).toBe('<div>first</div>');

    await act(() => root.render(<App text="second" />));
    expect(container.innerHTML).toBe('<div>second</div>');
  });

  // @gate enableFeature
  it('useFeature returns a dispatch function', async () => {
    let dispatch;
    function App() {
      const [state, _dispatch] = useFeature('initial');
      dispatch = _dispatch;
      return <div>{state}</div>;
    }

    const root = ReactDOMClient.createRoot(container);
    await act(() => root.render(<App />));
    expect(container.innerHTML).toBe('<div>initial</div>');
    expect(typeof dispatch).toBe('function');
  });

  // @gate enableFeature
  it('useFeature works alongside useState for DOM updates', async () => {
    let setCount;
    function App() {
      const [count, _setCount] = useState(0);
      setCount = _setCount;
      const [featureState] = useFeature(count);
      return (
        <div>
          <span>Count: {count}</span>
          <span>Feature: {featureState}</span>
        </div>
      );
    }

    const root = ReactDOMClient.createRoot(container);
    await act(() => root.render(<App />));
    expect(container.innerHTML).toBe(
      '<div><span>Count: 0</span><span>Feature: 0</span></div>',
    );

    await act(() => setCount(5));
    expect(container.innerHTML).toBe(
      '<div><span>Count: 5</span><span>Feature: 5</span></div>',
    );
  });

  // @gate enableFeature
  it('useFeature works with useEffect in DOM context', async () => {
    function App() {
      const [state] = useFeature('mounted');
      useEffect(() => {
        Scheduler.log('Effect mount: ' + state);
        return () => {
          Scheduler.log('Effect cleanup: ' + state);
        };
      }, [state]);
      return <div>{state}</div>;
    }

    const root = ReactDOMClient.createRoot(container);
    await act(() => root.render(<App />));
    assertLog(['Effect mount: mounted']);
    expect(container.innerHTML).toBe('<div>mounted</div>');
  });

  // @gate enableFeature
  it('useFeature works with useLayoutEffect in DOM context', async () => {
    function App() {
      const [state] = useFeature('layout');
      useLayoutEffect(() => {
        Scheduler.log('Layout effect: ' + state);
        return () => {
          Scheduler.log('Layout cleanup: ' + state);
        };
      });
      return <div>{state}</div>;
    }

    const root = ReactDOMClient.createRoot(container);
    await act(() => root.render(<App />));
    assertLog(['Layout effect: layout']);
    expect(container.innerHTML).toBe('<div>layout</div>');
  });

  // ---------------------------------------------------------------------------
  // Suspense interaction tests
  // ---------------------------------------------------------------------------

  // @gate enableFeature
  it('useFeature works with Suspense boundaries', async () => {
    function Child() {
      const [state] = useFeature('resolved');
      return <Text text={state} />;
    }

    function App() {
      return (
        <Suspense fallback={<div>Loading...</div>}>
          <Child />
        </Suspense>
      );
    }

    const root = ReactDOMClient.createRoot(container);
    await act(() => root.render(<App />));
    assertLog(['resolved']);
    expect(container.textContent).toBe('resolved');
  });

  // @gate enableFeature
  it('Feature component works inside a Suspense boundary', async () => {
    function App() {
      return (
        <Suspense fallback={<div>Loading...</div>}>
          <Feature mode="active">
            <Text text="Content" />
          </Feature>
        </Suspense>
      );
    }

    const root = ReactDOMClient.createRoot(container);
    await act(() => root.render(<App />));
    assertLog(['Content']);
    expect(container.textContent).toBe('Content');
  });

  // ---------------------------------------------------------------------------
  // DOM output verification
  // ---------------------------------------------------------------------------

  // @gate enableFeature
  it('produces correct DOM structure with nested elements', async () => {
    function App() {
      const [state] = useFeature('nested');
      return (
        <div id="outer">
          <Feature mode="active">
            <p>{state}</p>
          </Feature>
        </div>
      );
    }

    const root = ReactDOMClient.createRoot(container);
    await act(() => root.render(<App />));
    expect(container.querySelector('#outer')).not.toBeNull();
    expect(container.querySelector('p')).not.toBeNull();
    expect(container.querySelector('p').textContent).toBe('nested');
  });

  // @gate enableFeature
  it('Feature component accepts a name prop', async () => {
    function App() {
      return (
        <Feature mode="active" name="test-feature">
          <Text text="Named Feature" />
        </Feature>
      );
    }

    const root = ReactDOMClient.createRoot(container);
    await act(() => root.render(<App />));
    assertLog(['Named Feature']);
    expect(container.textContent).toBe('Named Feature');
  });

  // @gate enableFeature
  it('Feature component handles null children', async () => {
    function App() {
      return (
        <Feature mode="active">
          {null}
        </Feature>
      );
    }

    const root = ReactDOMClient.createRoot(container);
    await act(() => root.render(<App />));
    // Should not crash and produce empty output
    expect(container.innerHTML).toBe('');
  });

  // @gate enableFeature
  it('multiple Feature components render independently', async () => {
    function App() {
      return (
        <div>
          <Feature mode="active">
            <Text text="First" />
          </Feature>
          <Feature mode="inactive">
            <Text text="Second" />
          </Feature>
        </div>
      );
    }

    const root = ReactDOMClient.createRoot(container);
    await act(() => root.render(<App />));
    assertLog(['First', 'Second']);
    expect(container.textContent).toContain('First');
    expect(container.textContent).toContain('Second');
  });

  // @gate enableFeature
  it('useFeature handles unmounting correctly with effects', async () => {
    function Child() {
      const [state] = useFeature('child');
      useEffect(() => {
        Scheduler.log('Mount: ' + state);
        return () => {
          Scheduler.log('Cleanup: ' + state);
        };
      }, [state]);
      return <span>{state}</span>;
    }

    let setShow;
    function App() {
      const [show, _setShow] = useState(true);
      setShow = _setShow;
      return <div>{show ? <Child /> : null}</div>;
    }

    const root = ReactDOMClient.createRoot(container);
    await act(() => root.render(<App />));
    assertLog(['Mount: child']);
    expect(container.innerHTML).toBe('<div><span>child</span></div>');

    // Unmount the child
    await act(() => setShow(false));
    assertLog(['Cleanup: child']);
    expect(container.innerHTML).toBe('<div></div>');
  });

  // @gate enableFeature
  it('useFeature in nested components with DOM output', async () => {
    function Parent({value}) {
      const [parentState] = useFeature(value);
      return (
        <div>
          <span>Parent: {parentState}</span>
          <Child value={parentState} />
        </div>
      );
    }

    function Child({value}) {
      const [childState] = useFeature(value);
      return <span>Child: {childState}</span>;
    }

    const root = ReactDOMClient.createRoot(container);
    await act(() => root.render(<Parent value="hello" />));
    expect(container.innerHTML).toBe(
      '<div><span>Parent: hello</span><span>Child: hello</span></div>',
    );

    // Update parent value
    await act(() => root.render(<Parent value="world" />));
    expect(container.innerHTML).toBe(
      '<div><span>Parent: world</span><span>Child: world</span></div>',
    );
  });
});
