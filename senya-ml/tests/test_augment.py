import numpy as np

from app.core import augment, data


def test_copies_for_tops_small_classes_up_to_about_the_floor():
    assert augment.copies_for(2) == 18     # 2 x (plain + mirror + 18) = 40 arrays
    assert augment.copies_for(8) == 3      # ceil(40/8) - 2 = 3, the usual amount
    assert augment.copies_for(100) == 3
    assert augment.copies_for(0) == 3


def test_augment_sequence_honours_copies():
    seq = data.synthetic_export(seed=0)["signs"][3]["uploads"][0]["sequences"][0]
    out = augment.augment_sequence(data.sequence_to_array, seq, np.random.default_rng(0), copies=augment.copies_for(2))
    assert len(out) == 20
