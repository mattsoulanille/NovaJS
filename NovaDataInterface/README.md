# NovaDataInterface
A TypeScript interface for NovaJS's data. NovaDataInterface defines the interface 
for anything that provides game data to [NovaJS](https://github.com/mattsoulanille/NovaJS)

# Prerequisites
`npm`, `node`

# Installing
NovaDataInterface is [available on npm](https://www.npmjs.com/package/novadatainterface?activeTab=versions) as novadatainterface.

# Development
## Installing
  After cloning the repository, install dependencies with 
  
  ```npm install```
  
  Then, build with
  
  ```npm run build```
  
  Tests can be run with

  ```npm run test```

## Project Structure
  `src` contains all the project code not used for testing. Compiled typescript definitions end up in the project root directory because that's where they need to be in 
  order for them to be accessable when this package is installed with npm.
  
  `src/GameDataInterface.ts` is what NovaJS expects all file readers to implement. It has a member 
  `ids: Promise<NovaIDs>`, which resolves to an object that has a list of available ids for each NovaJS data type
  (such as `Ship` or `SpriteSheet`). It also has as a member a `NovaDataInterface`,
  which is where the NovaJS data types are aggregated. These data types are defined in `src/`.
  
  For each data type, `NovaDataInterface` has a corresponding [Gettable](https://github.com/mattsoulanille/NovaDataInterface/blob/master/src/Gettable.ts), 
  which is an object used for asynchronously requesting instances of that data type. A `Gettable<T>` is initialized with a
  function of type `(id: string) => Promise<T>`, which it uses to fulfill requests made to it via its `.get(id: string): Promise<T>`
  method. An implementation of `Gettable` that caches every requested item is provided, but need not be used, and a different
  implementation may be used as long as it conforms to the same type.
  
  See [NovaParse (typescript branch)](https://github.com/mattsoulanille/NovaParse/tree/typescript) for NovaJS's
  Nova File parser, which implements this interface.
  
  
  
  
  
