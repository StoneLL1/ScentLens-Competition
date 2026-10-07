import { coordinator, mockDevice, mockGeneration, repository } from '../app/runtime'
import { createScentProfile } from '../vendor/scent-profile'
import { getLiveControllerCount } from '../vendor/scent-profile/motion/controller'

export function installControls() {
  Object.assign(window, { __task02: {
    coordinator, device: mockDevice, generator: mockGeneration, repository, createScentProfile,
    liveProfiles: getLiveControllerCount,
    failNextSave() {
      const original = repository.save.bind(repository)
      repository.save = async () => { repository.save = original; throw new Error('Injected storage failure') }
    },
  } })
}
