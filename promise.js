const isFunction = (func) => typeof func === 'function';
const isObject = (obj) => obj && typeof obj === 'object';

// Promise 的三种状态
const PEDDING = 'pedding',
      FULFILLED = 'fulfilled',
      REJECTED = 'rejected';

/**
   * 对 then 方法中的处理函数 onFulfilled / onRejected 的返回值进行处理
   * @param {*} promise then 方法返回的 promise 对象
   * @param {*} x 处理函数的返回值
   * @param {*} resolve
   * @param {*} reject
   */
const resolvePromise = (promise, x, resolve, reject) => {
  // [Promises/A+ 2.3.1] 循环引用，返回 Promise<rejected>
  if (promise === x) {
    return reject(new TypeError('Chaining cycle detected for promise'));
  }

  // [Promises/A+ 2.3.2] 处理函数返回值是一个 Promise 对象，则要等到 Promise 对象变为确定状态
  if (x instanceof Promise) {
    x.then(value => {
      resolvePromise(promise, value, resolve, reject);
    }, reason => {
      reject(reason);
    });
  } 

  // [Promises/A+ 2.3.3] 处理函数返回值是一个对象或者函数  
  else if (isObject(x) || isFunction(x)) {
    // 检索 x.then 导致报错，返回 Promise<rejected ErrorReason>
    let then;
    try {
      then = x.then;
    } catch (error) {
      return reject(error);
    }

    // 是 thenable 类型的数据且 then 是一个方法，绑定到 x 上执行 then 方法，通过回调函数接收结果
    if (isFunction(then)) {
      // 无论是 Promise 还是 thenable，状态都是从 pedding 状态变为 fulfilled/rejected。
      // 且一旦确定就不可再修改，对应的处理函数也只会执行一次，结果也是第一次确定的结果
      // Promise 是根据 state（pedding、fulfilled、rejected）约束，thenable 是根据 called（true、false）约束
      let called = false;

      try {
        then.call(
          x, 
          y => {
            if (called) return;
            called = true;
            resolvePromise(promise, y, resolve, reject);
          }, 
          r => {
            if (called) return;
            called = true;
            reject(r);
          }
        );
      } catch (error) {
        if (called) return;
        called = true;
        reject(error);
      }
    } else {
      resolve(x);
    }
  }

  // 如果处理函数是普通值，那么直接将这个结果作为新的 Promise 结果返回
  else {
    resolve(x);
  }
}

class Promise {
  constructor(executor) {
    // 校验参数类型是否是函数，如果不是抛出错误
    if (!isFunction(executor)) {
      throw new TypeError(`Promise resolver ${executor} is not a function`);
    }

    this.initValue();

    // 同步执行函数参数，使用 try\catch 块包裹，为了捕获参数函数中可能出现的错误
    try {
      executor(this.resolve, this.reject);
    } catch (error) {
      this.reject(error)
    }
  }

  /**
   * 初始化 Promise 内部变量
   * @memberof Promise
   */
  initValue() {
    this.state = PEDDING;
    this.value = null;
    this.reason = null;
    // 一个 Promise 的 then 方法是可以被调用多次的，如果是异步改变状态，则需要将每个 then 中处理函数都分别存储起来
    this.fulfilledCallbacks = [];
    this.rejectedCallbacks = [];
  }

  /**
   * 由于 resolve 和 reject 是在 new Promise 中的函数中直接执行的，相当于全局状态下执行，
   * class 内部采用了严格模式，因此 resolve 函数中的 this 等于 undefined，
   * 所以需要用箭头函数，使其内部 this 始终等于实例
   * 
   * 1. 只有当 Promise 状态还是 pedding 时，才会执行下面的内容
   * 2. 将成功状态的结果保存
   * 3. 修改 Promise 状态为 fulfilled
   * 4. 如果是异步执行的改方法，那么需要执行其对应的处理函数
   * @param {*} value
   * @memberof Promise
   */
  resolve = value => {
    if (this.state === PEDDING) {
      this.value = value;
      this.state = FULFILLED;
      // 将所有的成功的回调都执行，队列，先存储的先执行（执行完毕的就没必要再保存了，因为只能执行一次）
      while(this.fulfilledCallbacks.length) {
        this.fulfilledCallbacks.shift()();
      }
    }
  }

  /**
   * 1. 只有当 Promise 状态还是 pedding 时，才会执行下面的内容
   * 2. 将失败状态的值保存起来
   * 3. 修改 Promise 状态为 rejected
   * 4. 如果是异步执行的改方法，那么需要执行其对应的处理函数
   * @param {*} reason
   * @memberof Promise
   */
  reject = reason => {
    if (this.state === PEDDING) {
      this.reason = reason;
      this.state = REJECTED;
      while(this.rejectedCallbacks.length) {
        this.rejectedCallbacks.shift()();
      }
    }
  }

  /**
   * 返回一个新的 Promise 对象
   * @param {*} onFulfilled 成功处理函数
   * @param {*} onRejected 失败处理函数
   * @returns
   * @memberof Promise
   */
  then(onFulfilled, onRejected) {
    // 如果 onFulfilled 不是函数类型，默认创建一个将正确的值向下传递的函数
    if (!isFunction(onFulfilled)) {
      onFulfilled = value => value;
    }

    // 如果 onRejected 不是函数类型，默认创建一个将错误的值向下抛出的函数
    if (!isFunction(onRejected)) {
      onRejected = reason => { throw reason };
    }

    const promise = new Promise((resolve, reject) => {
      // 将成功和失败的处理函数包装成微任务函数（函数体也可能会抛出错误，因此应该在最近的部分将错误捕获）
      const onFulfilledMicrotask = () => queueMicrotask(() => {
        try {
          const x = onFulfilled(this.value);
          resolvePromise(promise, x, resolve, reject);
        } catch (error) {
          reject(error);
        }
      });
  
      const onRejectedMicrotask = () => queueMicrotask(() => {
        try {
          const x = onRejected(this.reason);
          resolvePromise(promise, x, resolve, reject);
        } catch (error) {
          reject(error);
        }
      });

      if (this.state === FULFILLED) {
        // 同步修改 Promise 状态为 fulfilled
        onFulfilledMicrotask();
      } else if (this.state === REJECTED) {
        // 同步修改 Promise 状态为 rejected
        onRejectedMicrotask();
      } else if (this.state === PEDDING) {
        // 异步修改 Promise 状态时，会先执行 then，此时状态还是 pedding，无法执行处理函数，因此需要先存起来，等到状态确定再拿出来执行
        this.fulfilledCallbacks.push(onFulfilledMicrotask);
        this.rejectedCallbacks.push(onRejectedMicrotask);
      }
    });

    return promise;
  }

  /**
   * 用于处理 Promise 在 rejected 状态时要做的事情
   * @param {*} onRejected
   * @returns
   * @memberof Promise
   */
  catch(onRejected) {
    return this.then(null, onRejected);
  }

  /**
   * 不管 Promise 的状态是 fulfilled 还是 rejected 都会执行的处理函数。
   * then 方法中 onFulfilled 和 onRejected 处理函数都要执行的代码，可以放在 finally 中，因此也是 then 方法的语法糖
   * @param {*} onFinallied
   * @returns
   * @memberof Promise
   */
  finally(onFinallied) {
    if (!isFunction(onFinallied)) {
      onFinallied = () => {}
    }
    // 拿到当前构造函数
    const P = this.constructor;

    // 虽然 finally 处理函数内部是不知道 Promise 状态的，但是 finally 方法本身还是知道调用的 Promise 是什么状态的
    // P.resolve(onFinallied()) 的返回值是 P<pedding> P<fulfilled onFinallied()返回值>、P<rejected onFinallied()返回值或报错信息> 之一
    // then 只定义了 onFulfilled 方法，并且向下传递的值是当前 Promise 的结果而不是上面的返回结果，这也就印证了，如果处理函数正常执行，且没报错就延续前一个 Promise 的状态和结果
    // then 中没有定义的 onRejected 方法，则会默认创建一个新的方法，并且这个新的方法默认抛出当前 Promise 的结果，也就是 P.resolve(onFinallied()) 的返回值。
    return this.then(
      value => P.resolve(onFinallied()).then(() => value),
      reason => P.resolve(onFinallied()).then(() => { throw reason })
    );
  }

  /**
   * 将一个对象包装成 Promise 对象
   * @static
   * @param {*} value
   * @returns
   * @memberof Promise
   */
  static resolve(value) {
    // Promise.resolve() 拥有 "幂等" 特性。
    // 也就是如果参数是一个 Promise 类型的数据，那么返回结果还是参数对应的 promise
    if (value instanceof Promise) {
      return value;
    }

    // 如果是一个 thenable 对象，也要转为 Promise 对象，且直接执行 then 方法
    if (isObject(value) && isFunction(value.then)) {
      return new Promise((resolve, reject) => {
        value.then(resolve, reject);
      });
    }

    return new Promise(resolve => {
      resolve(value);
    });
  }

  /**
   * 返回一个 rejected 状态的 Promise，且参数会原封不动的作为 Promise 的 reason
   * @static
   * @param {*} reason
   * @returns
   * @memberof Promise
   */
  static reject(reason) {
    // Promise.reject() 的参数会原封不动的作为新的 Promise 的拒绝理由
    return new Promise((resolve, reject) => {
      reject(reason);
    });
  }

  /**
   * 批量处理多个 promise 实例组成的可迭代对象，返回一个新的 promise 实例
   * @static
   * @param {*} promises
   * @returns
   * @memberof Promise
   */
  static all(promises) {
    // 参数必须是一个可迭代对象
    if (!promises[Symbol.iterator]) {
      throw new TypeError(`${promises} is not iterable (cannot read property Symbol(Symbol.iterator))`);
    }

    let total = 0;
    const results = [];
    const promisesLists = [...promises];
    // 当参数是空的可迭代对象时，直接返回
    if (!promisesLists.length) return this.resolve(results);

    return new this((resolve, reject) => {
      promisesLists.forEach((p, i) => {
        // 将参数中的每一项都用 Promise.resolve 处理一下。并发执行
        this.resolve(p).then(value => {
          // 当前 Promise 执行成功，那么将结果存起来，等到全部执行完毕，再一起将数组返回出去
          // Promise.all 执行成功的值必须和参数中的位置一致，因此要使用索引去存，而不是 push 方法
          results[i] = value;
          // 对应了 Promise.all 只有参数列表中的所有项都执行成功才会返回成功的定义
          // 用 total 而不用 results.length 去比较是因为，有可能最后一个 promise 先执行完，
          // 且存储的索引是 length - 1，前面的还没执行完，但是等式成立，就返回了带有空值的数组
          (++total === promisesLists.length) && resolve(results);
        }, reason => {
          // 如果有一个 Promise 执行失败了，那么直接将状态修改，并将第一个原因返回
          reject(reason);
        });
      });
    });
  }

  /**
   * 返回一个新的 promise，且状态和结果为参数列表中第一个先执行完的数组项的状态和结果
   * @static
   * @param {*} promises
   * @returns
   * @memberof Promise
   */
  static race(promises) {
    // Promise.race 参数必须是一个可迭代对象
    if (!promises[Symbol.iterator]) {
      throw new TypeError(`${promises} is not iterable (cannot read property Symbol(Symbol.iterator))`);
    }

    return new this((resolve, reject) => {
      [...promises].forEach(p => {
        // 将最先执行完的结果返回出去，无论成功还是失败，都是返回最先执行完的结果
        this.resolve(p).then(resolve, reject);
      });
    });
  }

  /**
   * 返回一个新的 Promise，且状态只能是 pedding 或者 fulfilled
   * 当参数列表中所有的 promise 状态都执行完毕，不管是成功还是失败，其状态才会变为 fulfilled，永远不可能是 rejected
   * @static
   * @param {*} promises
   * @returns
   * @memberof Promise
   */
  static allSettled(promises) {
    // Promise.allSettled 参数必须是一个可迭代对象
    if (!promises[Symbol.iterator]) {
      throw new TypeError(`${promises} is not iterable (cannot read property Symbol(Symbol.iterator))`)
    }

    let total = 0;
    const results = [];
    const promisesLists = [...promises];
    if (!promisesLists.length) return this.resolve(results);

    return new this(resolve => {
      promisesLists.forEach((p, i) => {
        this.resolve(p).then(value => {
          // 将执行成功的 promise 结果存起来
          results[i] = { status: FULFILLED, value };
          // 返回全部执行完毕的结果，不管 promise 的结果是什么状态
          (++total === promisesLists.length) && resolve(results);
        }, reason => {
          // 将执行失败的 promise 结果存起来
          results[i] = { status: REJECTED, reason };
          // 返回全部执行完毕的结果，不管 promise 的结果是什么状态
          (++total === promisesLists.length) && resolve(results);
        });
      })
    })
  }


  /**
   * 返回一个 Promise 实例，功能与 all 相反。
   * 返回第一个成功的 promise 状态和结果，或者参数中所有的 promise 都变为 rejected 状态，最终的结果也是 rejected
   * @static
   * @param {*} promises
   * @returns
   * @memberof Promise
   */
  static any(promises) {
    // Promise.any 参数必须是一个可迭代对象
    if (!promises[Symbol.iterator]) {
      throw new TypeError(`${promises} is not iterable (cannot read property Symbol(Symbol.iterator))`);
    }

    let total = 0;
    // any 返回的 rejected 状态的结果是一个 AggregateError 实例（试验中的功能），继承 Array，类似于数组
    // 里面的每一项错误信息都是 Error 实例
    const results = new AggregateError();
    const promisesLists = [...promises];
    if (!promisesLists.length) return this.reject(results);

    return new this((resolve, reject) => {
      promisesLists.forEach((p, i) => {
        this.resolve(p).then(value => {
          // 返回第一个成功的结果
          resolve(value);
        }, reason => {
          // 错误原因为 Error 实例，且存放在 AggregateError 实例中
          results[i] = new Error(reason);
          // 全部失败，最终返回失败的结果
          (++total === promisesLists.length) && reject(results);
        });
      });
    });
  }
}

/**
 * 测试封装的 Promise 是否正确，测试完毕后控制台回显示成功和失败的测试用例条数
 * 
 * 1. npm install promises-aplus-tests
 * 2. 将下面代码复制到自定义 Promise 所在的文件中
 * 3. 运行命令 npx promises-aplus-tests <手写 Promise 的文件名>
 */
Promise.defer = Promise.deferred = function() {
  let dfd = {};
  dfd.promise = new Promise((resolve, reject) => {
    dfd.resolve = resolve;
    dfd.reject = reject;
  });
  return dfd;
}

module.exports = Promise;